use crate::{AcxError, MAX_MESSAGE_BYTES, Provider};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}
impl Provider {
    pub fn handle_line(&mut self, line: &[u8]) -> Value {
        if line.len() > MAX_MESSAGE_BYTES {
            return json!({"id":null,"error":AcxError::new("limit_exceeded","message exceeds 256 KiB")});
        }
        match serde_json::from_slice::<Envelope>(line) {
            Ok(request) => match self.dispatch(&request.method, request.params) {
                Ok(result) => json!({"id":request.id,"result":result}),
                Err(error) => json!({"id":request.id,"error":error}),
            },
            Err(error) => json!({"id":null,"error":AcxError::from(error)}),
        }
    }
}
/// Bounded JSON Lines. Overlong lines are drained without unbounded allocation.
/// The owner grants access by handing this dedicated process/pipe to its agent.
pub fn serve<R: BufRead, W: Write>(
    provider: &mut Provider,
    mut input: R,
    mut output: W,
    mut changed: impl FnMut(),
) -> io::Result<()> {
    loop {
        let mut line = Vec::new();
        let mut oversized = false;
        let mut consumed = false;
        loop {
            let buffer = input.fill_buf()?;
            if buffer.is_empty() {
                break;
            }
            let end = buffer
                .iter()
                .position(|b| *b == b'\n')
                .map(|p| p + 1)
                .unwrap_or(buffer.len());
            consumed = true;
            if line.len() + end > MAX_MESSAGE_BYTES {
                oversized = true;
            }
            if !oversized {
                line.extend_from_slice(&buffer[..end]);
            }
            let complete = buffer[end - 1] == b'\n';
            input.consume(end);
            if complete {
                break;
            }
        }
        if !consumed {
            return Ok(());
        }
        let response = if oversized {
            json!({"id":null,"error":AcxError::new("limit_exceeded","message exceeds 256 KiB")})
        } else {
            provider.handle_line(&line)
        };
        serde_json::to_writer(&mut output, &response)?;
        output.write_all(b"\n")?;
        output.flush()?;
        if provider.take_changed() {
            changed();
        }
    }
}
