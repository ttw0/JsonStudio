mod parser;
mod schema;
mod type_shape;

use serde_json::Value;

use parser::parse_code_to_json_ast;
use schema::{gen_protobuf, gen_thrift};

#[tauri::command]
pub fn json_to_code(content: &str, language: &str, class_name: &str) -> Result<String, String> {
    let value: Value =
        serde_json::from_str(content).map_err(|error| format!("Invalid JSON: {error}"))?;
    ensure_integer_range(&value)?;

    match &value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            return Err("JSON must be an object or array to generate code structures".into());
        }
        Value::Array(values) if values.is_empty() => {
            return Err("Empty JSON array: cannot infer element types".into());
        }
        _ => {}
    }

    let name = if class_name.trim().is_empty() {
        "Root"
    } else {
        class_name.trim()
    };

    match language {
        "protobuf" => Ok(gen_protobuf(&value, name)),
        "thrift" => Ok(gen_thrift(&value, name)),
        _ => Err(format!("Unsupported language: {language}")),
    }
}

fn ensure_integer_range(value: &Value) -> Result<(), String> {
    match value {
        Value::Number(number) => {
            let raw = number.to_string();
            if !raw.contains(['.', 'e', 'E']) && number.as_i64().is_none() {
                return Err(format!("Code generation cannot represent this integer in signed 64-bit fields: {raw}"));
            }
            if raw.contains(['.', 'e', 'E']) && number.as_f64().is_none_or(|value| {
                !value.is_finite() || value.abs() > 9_007_199_254_740_991.0
            }) {
                return Err("Code generation cannot safely infer this exponent-form numeric value".into());
            }
        }
        Value::Array(values) => {
            for value in values { ensure_integer_range(value)?; }
        }
        Value::Object(values) => {
            for value in values.values() { ensure_integer_range(value)?; }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn code_to_json(content: &str, language: &str) -> Result<String, String> {
    let value = parse_code_to_json_ast(content, language)?;
    serde_json::to_string_pretty(&value)
        .map_err(|error| format!("JSON serialization failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::code_to_json;

    #[test]
    fn code_generation_rejects_integer_samples_outside_its_native_range() {
        let content = "{\"id\":123456789012345678901234567890}";
        assert!(super::json_to_code(content, "protobuf", "Example").unwrap_err().contains("64-bit"));
        assert!(super::json_to_code(content, "thrift", "Example").unwrap_err().contains("64-bit"));
        assert!(super::json_to_code("{\"id\":9223372036854775807}", "protobuf", "Example").is_ok());
        assert!(super::json_to_code("{\"id\":1e400}", "protobuf", "Example").is_err());
    }

    #[test]
    fn code_to_json_handles_javascript_constructor_assignments() {
        let source = r#"
class User {
    constructor(name) {
        this.name = name;
        this.active = true;
    }
}
"#;

        let json = code_to_json(source, "javascript").unwrap();
        assert_eq!(json, "{\n  \"name\": null,\n  \"active\": true\n}");
    }
}
