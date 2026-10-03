//! Portable property metadata and validation. This is a typed subset, not a JSON
//! Schema interpreter. String lengths count Unicode scalar values (Rust chars).
use crate::LocalizedText;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use unge_core::Properties;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PropertyType {
    Bool,
    Int {
        minimum: Option<i64>,
        maximum: Option<i64>,
    },
    Float {
        minimum: Option<f64>,
        maximum: Option<f64>,
    },
    String {
        #[serde(default)]
        min_length: usize,
        max_length: Option<usize>,
        choices: Option<Vec<String>>,
    },
    Json,
}
impl PropertyType {
    pub fn validate(&self, value: &Value) -> Result<(), String> {
        let valid = match self {
            Self::Bool => value.is_boolean(),
            Self::Int { minimum, maximum } => value.as_i64().is_some_and(|v| {
                minimum.is_none_or(|min| v >= min) && maximum.is_none_or(|max| v <= max)
            }),
            Self::Float { minimum, maximum } => value.as_f64().is_some_and(|v| {
                v.is_finite()
                    && minimum.is_none_or(|min| v >= min)
                    && maximum.is_none_or(|max| v <= max)
            }),
            Self::String {
                min_length,
                max_length,
                choices,
            } => value.as_str().is_some_and(|v| {
                let len = v.chars().count();
                len >= *min_length
                    && max_length.is_none_or(|max| len <= max)
                    && choices
                        .as_ref()
                        .is_none_or(|items| items.iter().any(|item| item == v))
            }),
            Self::Json => true,
        };
        if valid {
            Ok(())
        } else {
            Err("value does not match property type or constraints".into())
        }
    }
    fn validate_schema(&self) -> Result<(), String> {
        let valid = match self {
            Self::Int { minimum, maximum } => {
                minimum.zip(*maximum).is_none_or(|(min, max)| min <= max)
            }
            Self::Float { minimum, maximum } => {
                minimum.is_none_or(f64::is_finite)
                    && maximum.is_none_or(f64::is_finite)
                    && minimum.zip(*maximum).is_none_or(|(min, max)| min <= max)
            }
            Self::String {
                min_length,
                max_length,
                choices,
            } => {
                max_length.is_none_or(|max| *min_length <= max)
                    && choices.as_ref().is_none_or(|items| {
                        !items.is_empty()
                            && items.iter().all(|item| {
                                let len = item.chars().count();
                                len >= *min_length && max_length.is_none_or(|max| len <= max)
                            })
                            && items
                                .iter()
                                .collect::<std::collections::BTreeSet<_>>()
                                .len()
                                == items.len()
                    })
            }
            _ => true,
        };
        if valid {
            Ok(())
        } else {
            Err("invalid property constraints".into())
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PropertyDefinition {
    pub name: LocalizedText,
    pub description: LocalizedText,
    pub value_type: PropertyType,
    #[serde(default)]
    pub required: bool,
    /// Applied only by Definition::instantiate; validation never repairs values.
    /// Null represents no default, matching SetProperty's deletion convention.
    pub default: Option<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PropertySchema {
    #[serde(default)]
    pub fields: BTreeMap<String, PropertyDefinition>,
    #[serde(default = "allow_additional")]
    pub additional_properties: bool,
}
fn allow_additional() -> bool {
    true
}
impl Default for PropertySchema {
    fn default() -> Self {
        Self {
            fields: BTreeMap::new(),
            additional_properties: true,
        }
    }
}
impl PropertySchema {
    pub fn defaults(&self) -> Properties {
        self.fields
            .iter()
            .filter_map(|(key, field)| field.default.clone().map(|v| (key.clone(), v)))
            .collect()
    }
    pub fn validate_schema(&self) -> Result<(), String> {
        for (key, field) in &self.fields {
            if key.is_empty() {
                return Err("empty property name".into());
            }
            field
                .value_type
                .validate_schema()
                .map_err(|e| format!("{key}: {e}"))?;
            if let Some(default) = &field.default {
                if default.is_null() {
                    return Err(format!("{key}: null defaults are unsupported"));
                }
                field
                    .value_type
                    .validate(default)
                    .map_err(|e| format!("{key} default: {e}"))?;
            }
        }
        Ok(())
    }
    pub fn validate(&self, properties: &Properties) -> Result<(), String> {
        for (key, field) in &self.fields {
            match properties.get(key) {
                Some(value) => field
                    .value_type
                    .validate(value)
                    .map_err(|e| format!("{key}: {e}"))?,
                None if field.required => return Err(format!("{key}: required property missing")),
                None => {}
            }
        }
        if !self.additional_properties
            && let Some(key) = properties
                .keys()
                .find(|key| !self.fields.contains_key(*key))
        {
            return Err(format!("{key}: unknown property"));
        }
        Ok(())
    }
}
