use serde_json::Value;
use std::collections::HashMap;

const TOML_ROOT_ARRAY_MARKER: &str = "# jsonstudio:root-array";
const XML_KEY_ATTR: &str = "jsonstudio-key";

#[tauri::command]
pub fn json_to_yaml(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    ensure_native_number_range(&value, "YAML", false)?;
    serde_yaml::to_string(&value)
        .map_err(|e| format!("YAML conversion failed: {}", e))
}

#[tauri::command]
pub fn json_to_toml(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    let is_root_array = value.is_array();
    ensure_native_number_range(&value, "TOML", true)?;

    // TOML requires a top-level table; wrap arrays automatically
    let table_value = match &value {
        Value::Array(_) => {
            let mut map = serde_json::Map::new();
            map.insert("items".to_string(), value);
            Value::Object(map)
        }
        Value::Object(_) => value,
        _ => {
            return Err("TOML requires a JSON object or array at the top level".to_string());
        }
    };

    let toml = toml::to_string_pretty(&table_value)
        .map_err(|e| format!("TOML conversion failed: {}", e))?;
    if is_root_array {
        Ok(format!("{TOML_ROOT_ARRAY_MARKER}\n{toml}"))
    } else {
        Ok(toml)
    }
}

#[tauri::command]
pub fn json_to_xml(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    value_to_xml(&value, "root", &mut xml, 0);
    Ok(xml)
}

fn value_to_xml(value: &Value, tag: &str, xml: &mut String, depth: usize) {
    value_to_xml_node(value, tag, None, xml, depth);
}

fn value_to_xml_node(
    value: &Value,
    tag: &str,
    original_key: Option<&str>,
    xml: &mut String,
    depth: usize,
) {
    let indent = "  ".repeat(depth);
    let key_attr = original_key
        .map(|key| format!(" {XML_KEY_ATTR}=\"{}\"", escape_xml(key)))
        .unwrap_or_default();
    match value {
        Value::Object(map) => {
            let type_attr = if depth == 0 || map.is_empty() {
                " type=\"object\""
            } else {
                ""
            };
            let mut tag_counts = HashMap::new();
            for key in map.keys() {
                *tag_counts.entry(sanitize_xml_tag(key)).or_insert(0usize) += 1;
            }
            xml.push_str(&format!("{}<{}{}{}>\n", indent, tag, type_attr, key_attr));
            for (key, val) in map {
                let safe_key = sanitize_xml_tag(key);
                let needs_key_attr = safe_key != *key
                    || tag_counts.get(&safe_key).copied().unwrap_or(0) > 1;
                value_to_xml_node(
                    val,
                    &safe_key,
                    needs_key_attr.then_some(key.as_str()),
                    xml,
                    depth + 1,
                );
            }
            xml.push_str(&format!("{}</{}>\n", indent, tag));
        }
        Value::Array(arr) => {
            if arr.is_empty() {
                xml.push_str(&format!("{}<{} type=\"array\"{} />\n", indent, tag, key_attr));
            } else {
                xml.push_str(&format!("{}<{} type=\"array\"{}>\n", indent, tag, key_attr));
                for item in arr {
                    value_to_xml_node(item, "item", None, xml, depth + 1);
                }
                xml.push_str(&format!("{}</{}>\n", indent, tag));
            }
        }
        Value::String(s) => {
            xml.push_str(&format!("{}<{} type=\"string\"{}>{}</{}>\n", indent, tag, key_attr, escape_xml(s), tag));
        }
        Value::Number(n) => {
            xml.push_str(&format!("{}<{}{}>{}</{}>\n", indent, tag, key_attr, n, tag));
        }
        Value::Bool(b) => {
            xml.push_str(&format!("{}<{}{}>{}</{}>\n", indent, tag, key_attr, b, tag));
        }
        Value::Null => {
            xml.push_str(&format!("{}<{}{} />\n", indent, tag, key_attr));
        }
    }
}

fn sanitize_xml_tag(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    for (i, ch) in name.chars().enumerate() {
        if i == 0 && !ch.is_ascii_alphabetic() && ch != '_' {
            result.push('_');
        }
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
            result.push(ch);
        } else {
            result.push('_');
        }
    }
    if result.is_empty() {
        return "item".to_string();
    }
    result
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[tauri::command]
pub fn json_to_csv(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let arr = match &value {
        Value::Array(arr) => arr.clone(),
        Value::Object(_) => vec![value],
        _ => return Err("CSV requires JSON array or object".to_string()),
    };

    if arr.iter().any(|item| !item.is_object()) {
        return Err("CSV requires an object or an array of objects".to_string());
    }

    if arr.is_empty() {
        return Ok(String::new());
    }

    // Collect all unique keys as headers
    let mut headers: Vec<String> = Vec::new();
    let mut header_set = std::collections::HashSet::new();
    for item in &arr {
        if let Value::Object(map) = item {
            for key in map.keys() {
                if header_set.insert(key.clone()) {
                    headers.push(key.clone());
                }
            }
        }
    }

    if headers.is_empty() {
        return Err("CSV requires objects with keys".to_string());
    }

    let mut wtr = csv::Writer::from_writer(Vec::new());
    wtr.write_record(&headers).map_err(|e| format!("CSV error: {}", e))?;

    for item in &arr {
        if let Value::Object(map) = item {
            let row: Vec<String> = headers.iter().map(|h| {
                match map.get(h) {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Null) | None => String::new(),
                    Some(v) => v.to_string(),
                }
            }).collect();
            wtr.write_record(&row).map_err(|e| format!("CSV error: {}", e))?;
        }
    }

    let bytes = wtr.into_inner().map_err(|e| format!("CSV error: {}", e))?;
    String::from_utf8(bytes).map_err(|e| format!("CSV encoding error: {}", e))
}

// ============================================================
// Reverse conversions: YAML/TOML/XML/CSV → JSON
// ============================================================

#[tauri::command]
pub fn yaml_to_json(content: &str) -> Result<String, String> {
    let parsed: serde_yaml::Value = serde_yaml::from_str(content)
        .map_err(|e| format!("Invalid YAML: {e}"))?;
    ensure_yaml_number_range(&parsed)?;
    let value: Value = serde_yaml::from_str(content)
        .map_err(|e| format!("Invalid YAML: {}", e))?;
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("JSON conversion failed: {}", e))
}

fn ensure_native_number_range(value: &Value, format: &str, signed_only: bool) -> Result<(), String> {
    match value {
        Value::Number(number) => {
            let raw = number.to_string();
            let integer = !raw.contains(['.', 'e', 'E']);
            if integer && (number.as_i64().is_none() && (signed_only || number.as_u64().is_none())) {
                return Err(format!("{format} native conversion cannot represent this integer exactly: {raw}"));
            }
            if !integer {
                let float = number.as_f64().filter(|value| value.is_finite());
                if float.is_none() || float.is_some_and(|value| value.abs() > 9_007_199_254_740_991.0) {
                    return Err(format!("{format} native conversion would lose numeric precision: {raw}"));
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                ensure_native_number_range(value, format, signed_only)?;
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                ensure_native_number_range(value, format, signed_only)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn ensure_yaml_number_range(value: &serde_yaml::Value) -> Result<(), String> {
    match value {
        serde_yaml::Value::Number(number) if number.as_i64().is_none() && number.as_u64().is_none() => {
            if number.as_f64().is_none_or(|value| !value.is_finite() || value.abs() > 9_007_199_254_740_991.0) {
                return Err("YAML native conversion requires the lossless YAML parser for this numeric value".into());
            }
        }
        serde_yaml::Value::Sequence(values) => {
            for value in values {
                ensure_yaml_number_range(value)?;
            }
        }
        serde_yaml::Value::Mapping(values) => {
            for (key, value) in values {
                ensure_yaml_number_range(key)?;
                ensure_yaml_number_range(value)?;
            }
        }
        serde_yaml::Value::Tagged(value) => ensure_yaml_number_range(&value.value)?,
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn toml_to_json(content: &str) -> Result<String, String> {
    let is_root_array = content
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim() == TOML_ROOT_ARRAY_MARKER)
        .unwrap_or(false);
    let value: Value = toml::from_str(content)
        .map_err(|e| format!("Invalid TOML: {}", e))?;
    ensure_native_number_range(&value, "TOML", true)?;
    let value = if is_root_array {
        match value {
            Value::Object(mut map) if map.len() == 1 => match map.remove("items") {
                Some(Value::Array(items)) => Value::Array(items),
                _ => return Err("Invalid JsonStudio root array TOML".to_string()),
            },
            _ => return Err("Invalid JsonStudio root array TOML".to_string()),
        }
    } else {
        value
    };
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("JSON conversion failed: {}", e))
}

#[tauri::command]
pub fn xml_to_json(content: &str) -> Result<String, String> {
    let value = parse_xml_to_value(content)?;
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("JSON conversion failed: {}", e))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum XmlValueKind {
    Unspecified,
    Array,
    Object,
    String,
}

enum XmlChild {
    Element(String, Value),
    Text(String),
}

struct XmlFrame {
    key: String,
    kind: XmlValueKind,
    children: Vec<XmlChild>,
}

fn parse_xml_element_metadata(
    element: &quick_xml::events::BytesStart<'_>,
) -> Result<(XmlValueKind, Option<String>), String> {
    let mut kind = XmlValueKind::Unspecified;
    let mut original_key = None;
    for attr in element.attributes() {
        let attr = attr.map_err(|e| format!("Invalid XML attribute: {}", e))?;
        let value = attr
            .unescape_value()
            .map_err(|e| format!("XML attribute decode error: {}", e))?;
        if attr.key.as_ref() == b"type" && value == "array" {
            kind = XmlValueKind::Array;
        } else if attr.key.as_ref() == b"type" && value == "object" {
            kind = XmlValueKind::Object;
        } else if attr.key.as_ref() == b"type" && value == "string" {
            kind = XmlValueKind::String;
        } else if attr.key.as_ref() == XML_KEY_ATTR.as_bytes() {
            original_key = Some(value.into_owned());
        }
    }
    Ok((kind, original_key))
}

fn parse_xml_to_value(xml_str: &str) -> Result<Value, String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let mut reader = Reader::from_str(xml_str);
    let mut stack: Vec<XmlFrame> = Vec::new();
    let mut root_value: Option<Value> = None;
    let mut root_is_object = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let (kind, original_key) = parse_xml_element_metadata(&e)?;
                stack.push(XmlFrame {
                    key: original_key.unwrap_or(tag),
                    kind,
                    children: Vec::new(),
                });
            }
            Ok(Event::End(_)) => {
                if let Some(frame) = stack.pop() {
                    let value = children_to_value(frame.children, frame.kind)?;
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(XmlChild::Element(frame.key, value));
                    } else {
                        root_is_object = frame.kind == XmlValueKind::Object;
                        root_value = Some(value);
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let (kind, original_key) = parse_xml_element_metadata(&e)?;
                let value = children_to_value(Vec::new(), kind)?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(XmlChild::Element(original_key.unwrap_or(tag), value));
                } else {
                    root_is_object = kind == XmlValueKind::Object;
                    root_value = Some(value);
                }
            }
            Ok(Event::Text(e)) => {
                let raw = std::str::from_utf8(e.as_ref())
                    .map_err(|err| format!("XML text decode error: {}", err))?;
                let text = quick_xml::escape::unescape(raw)
                    .map_err(|err| format!("XML unescape error: {}", err))?
                    .to_string();
                if let Some(parent) = stack.last_mut() {
                    if parent.kind != XmlValueKind::String && text.trim().is_empty() { continue; }
                    parent.children.push(XmlChild::Text(text));
                }
            }
            Ok(Event::CData(e)) => {
                let raw = std::str::from_utf8(e.as_ref())
                    .map_err(|err| format!("XML cdata decode error: {}", err))?;
                let text = raw.to_string();
                if !text.is_empty() {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(XmlChild::Text(text));
                    }
                }
            }
            Ok(Event::GeneralRef(e)) => {
                let raw = std::str::from_utf8(e.as_ref())
                    .map_err(|err| format!("XML entity decode error: {err}"))?;
                let reference = format!("&{raw};");
                let text = quick_xml::escape::unescape(&reference)
                    .map_err(|err| format!("XML entity decode error: {err}"))?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(XmlChild::Text(text.into_owned()));
                }
            }
            Ok(Event::Eof) => break,
            Ok(Event::Decl(_)) | Ok(Event::Comment(_)) | Ok(Event::PI(_))
            | Ok(Event::DocType(_)) => {}
            Err(e) => return Err(format!("Invalid XML: {}", e)),
        }
    }

    // Unwrap the root element to return its content directly
    match root_value {
        Some(Value::Object(map)) if !root_is_object && map.len() == 1 => {
            Ok(map.into_iter().next().unwrap().1)
        }
        Some(v) => Ok(v),
        None => Err("Empty XML document".into()),
    }
}

fn text_to_typed_value(text: &str) -> Value {
    if text == "true" {
        return Value::Bool(true);
    }
    if text == "false" {
        return Value::Bool(false);
    }
    if let Ok(Value::Number(number)) = serde_json::from_str::<Value>(text) {
        return Value::Number(number);
    }
    Value::String(text.to_string())
}

fn children_to_value(children: Vec<XmlChild>, kind: XmlValueKind) -> Result<Value, String> {
    let mut elements = Vec::new();
    let mut text: Option<String> = None;
    for child in children {
        match child {
            XmlChild::Element(key, value) => elements.push((key, value)),
            XmlChild::Text(chunk) => text.get_or_insert_with(String::new).push_str(&chunk),
        }
    }
    if kind == XmlValueKind::String {
        if !elements.is_empty() {
            return Err("XML string elements cannot contain child elements".into());
        }
        return Ok(Value::String(text.unwrap_or_default()));
    }
    if kind == XmlValueKind::Array {
        return Ok(Value::Array(elements.into_iter().map(|(_, value)| value).collect()));
    }
    if elements.is_empty() {
        return Ok(match text {
            Some(text) => text_to_typed_value(text.trim()),
            None if kind == XmlValueKind::Object => Value::Object(serde_json::Map::new()),
            None => Value::Null,
        });
    }

    let mut tag_counts = HashMap::new();
    for (key, _) in &elements {
        *tag_counts.entry(key.clone()).or_insert(0usize) += 1;
    }
    let mut map = serde_json::Map::new();
    for (tag, value) in elements {
        if tag_counts[&tag] > 1 {
            let entry = map.entry(tag).or_insert_with(|| Value::Array(vec![]));
            if let Value::Array(arr) = entry {
                arr.push(value);
            }
        } else {
            map.insert(tag, value);
        }
    }

    Ok(Value::Object(map))
}

#[tauri::command]
pub fn csv_to_json(content: &str) -> Result<String, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(content.as_bytes());

    let headers: Vec<String> = rdr.headers()
        .map_err(|e| format!("CSV header error: {}", e))?
        .iter()
        .map(|h| h.to_string())
        .collect();

    if headers.is_empty() {
        return Err("CSV has no headers".into());
    }

    let mut rows: Vec<Value> = Vec::new();
    for result in rdr.records() {
        let record = result.map_err(|e| format!("CSV row error: {}", e))?;
        let mut obj = serde_json::Map::new();
        for (i, field) in record.iter().enumerate() {
            if let Some(header) = headers.get(i) {
                obj.insert(header.clone(), text_to_typed_value(field));
            }
        }
        rows.push(Value::Object(obj));
    }

    serde_json::to_string_pretty(&Value::Array(rows))
        .map_err(|e| format!("JSON conversion failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::{json_to_xml, xml_to_json};
    use serde_json::Value;

    #[test]
    fn xml_and_csv_preserve_arbitrary_integer_text() {
        for number in ["9007199254740993".to_string(), "18446744073709551615".to_string(), "9".repeat(400)] {
            let object = format!("{{\"id\":{number},\"negative\":-{number}}}");
            let xml = super::json_to_xml(&object).unwrap();
            let xml_json = super::xml_to_json(&xml).unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&xml_json).unwrap(),
                serde_json::from_str::<Value>(&object).unwrap(),
            );
            let array = format!("[{object}]");
            let csv = super::json_to_csv(&array).unwrap();
            let csv_json = super::csv_to_json(&csv).unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&csv_json).unwrap(),
                serde_json::from_str::<Value>(&array).unwrap(),
            );
        }
    }

    #[test]
    fn formats_with_native_numeric_limits_do_not_silently_round() {
        let source = "{\"id\":123456789012345678901234567890}";
        assert!(super::json_to_toml(source).unwrap_err().contains("exactly"));
        assert!(super::json_to_yaml(source).unwrap_err().contains("exactly"));
        assert!(super::yaml_to_json("id: 123456789012345678901234567890").is_err());
        assert!(super::toml_to_json("id = 9.007199254740993e15").unwrap_err().contains("precision"));
        assert!(super::toml_to_json("id = 9223372036854775807").is_ok());
    }

    #[test]
    fn xml_preserves_numeric_strings_and_exact_integer_numbers() {
        let source = r#"{"id":9007199254740993,"stringId":"9007199254740993","exponent":"9.007199254740993e15","empty":"","spaces":"  123  ","boolean":"true","escaped":"<&>"}"#;
        let xml = json_to_xml(source).unwrap();
        let converted = xml_to_json(&xml).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&converted).unwrap(), serde_json::from_str::<Value>(source).unwrap());
    }

    #[test]
    fn xml_field_names_do_not_collide_with_internal_text_nodes() {
        for source in [
            r#"{"__text__":9007199254740993}"#,
            r#"{"__text__":"9007199254740993","id":18446744073709551615}"#,
            r#"{"nested":{"__text__":{"id":9007199254740993}}}"#,
            r#"[{"__text__":9007199254740993}]"#,
        ] {
            let xml = json_to_xml(source).unwrap();
            let converted = xml_to_json(&xml).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&converted).unwrap(), serde_json::from_str::<Value>(source).unwrap());
        }
        assert_eq!(xml_to_json(r#"<root type="array"><__text__>9007199254740993</__text__></root>"#).unwrap(), "[\n  9007199254740993\n]");
    }

    #[test]
    fn structured_formats_round_trip_with_windows_line_endings() {
        let source = "{\r\n  \"name\": \"Alice\",\r\n  \"active\": true\r\n}";
        let expected: Value = serde_json::from_str(source).unwrap();
        type Convert = fn(&str) -> Result<String, String>;
        let formats: [(Convert, Convert); 3] = [
            (super::json_to_yaml, super::yaml_to_json),
            (super::json_to_toml, super::toml_to_json),
            (super::json_to_xml, super::xml_to_json),
        ];
        for (encode, decode) in formats {
            let encoded = encode(source).unwrap().replace("\r\n", "\n").replace('\n', "\r\n");
            let decoded = decode(&encoded).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&decoded).unwrap(), expected);
        }
        let csv = super::json_to_csv("[{\"name\":\"Alice\",\"active\":true}]").unwrap();
        let crlf = csv.replace("\r\n", "\n").replace('\n', "\r\n");
        assert_eq!(
            serde_json::from_str::<Value>(&super::csv_to_json(&crlf).unwrap()).unwrap(),
            serde_json::json!([{"name":"Alice","active":true}]),
        );
    }

    #[test]
    fn xml_round_trip_preserves_root_shapes() {
        let samples = [
            r#"{}"#,
            r#"{"id":1}"#,
            r#"{"item":"value"}"#,
            r#"[]"#,
            r#"[{}]"#,
            r#"[[],{"item":[1,2]}]"#,
        ];

        for source in samples {
            let xml = json_to_xml(source).expect("JSON should convert to XML");
            let converted = xml_to_json(&xml).expect("generated XML should convert to JSON");
            assert_eq!(
                serde_json::from_str::<Value>(&converted).unwrap(),
                serde_json::from_str::<Value>(source).unwrap(),
                "round trip failed for {source}: {xml}"
            );
        }
    }

    #[test]
    fn xml_round_trip_preserves_keys_that_need_sanitizing() {
        let source = r#"{"a b":1,"a_b":2,"1id":3,"":4,"中文":5}"#;
        let xml = json_to_xml(source).expect("JSON should convert to XML");
        let converted = xml_to_json(&xml).expect("generated XML should convert to JSON");

        assert_eq!(
            serde_json::from_str::<Value>(&converted).unwrap(),
            serde_json::from_str::<Value>(source).unwrap()
        );
    }

    #[test]
    fn xml_to_json_decodes_cdata_text() {
        let converted = xml_to_json("<root><![CDATA[<raw>]]></root>").unwrap();
        assert_eq!(converted, r#""<raw>""#);
    }

    #[test]
    fn toml_round_trip_preserves_root_arrays_without_unwrapping_regular_items_objects() {
        let array_source = r#"[{"id":1}]"#;
        let array_toml = super::json_to_toml(array_source).unwrap();
        assert!(array_toml.starts_with("# jsonstudio:root-array\n"));
        let array_json = super::toml_to_json(&array_toml).unwrap();
        assert_eq!(array_json, "[\n  {\n    \"id\": 1\n  }\n]");

        let object_source = r#"{"items":[1,2]}"#;
        let object_toml = super::json_to_toml(object_source).unwrap();
        let object_json = super::toml_to_json(&object_toml).unwrap();
        assert_eq!(object_json, "{\n  \"items\": [\n    1,\n    2\n  ]\n}");

        assert!(super::toml_to_json("# jsonstudio:root-array\nitems = [1]\nextra = 2").is_err());
        assert_eq!(
            super::toml_to_json("items = [1]\n# jsonstudio:root-array").unwrap(),
            "{\n  \"items\": [\n    1\n  ]\n}"
        );
    }

    #[test]
    fn csv_rejects_mixed_arrays_instead_of_dropping_rows() {
        let result = super::json_to_csv(r#"[{"id":1},2]"#);
        assert!(result.is_err());
    }
}
