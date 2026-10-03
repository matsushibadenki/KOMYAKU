//! Experimental ACX Node Graph Profile. Transport, authority and document ownership
//! are separate: a trusted host supplies policy and an atomic document adapter.
mod host;
mod intent;
mod provider;
mod transport;
pub use host::*;
pub use intent::*;
pub use provider::*;
pub use transport::*;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
pub const MAX_MESSAGE_BYTES: usize = 256 * 1024;
pub const PROFILE: &str = "experimental-node-graph-stdio-v1";
pub const EDIT: &str = "org.unge.graph.edit";
pub const RUN: &str = "org.unge.graph.run";
pub const OBSERVE: &str = "org.unge.graph.observe";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcxError {
    pub code: String,
    pub message: String,
}
impl AcxError {
    pub fn new(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
        }
    }
}
impl std::fmt::Display for AcxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for AcxError {}
impl From<unge_core::Error> for AcxError {
    fn from(error: unge_core::Error) -> Self {
        let code = if matches!(&error, unge_core::Error::Properties(_)) {
            "invalid_properties"
        } else {
            "invalid_graph"
        };
        Self::new(code, error)
    }
}
impl From<serde_json::Error> for AcxError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("invalid_request", error)
    }
}
pub type Result<T> = std::result::Result<T, AcxError>;
/// The wire profile hashes these exact UTF-8 bytes, not a client reserialization.
pub fn hash_bytes(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}
pub fn hash_json(value: &impl Serialize) -> Result<String> {
    Ok(hash_bytes(&serde_json::to_vec(value)?))
}
