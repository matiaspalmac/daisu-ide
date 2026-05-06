//! Content-Length framing for JSON-RPC over stdio.

use std::io;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

/// Read one framed message from `reader` and return the JSON bytes.
/// Returns `Ok(None)` if EOF reached cleanly between messages.
pub async fn read_frame<R>(reader: &mut R) -> io::Result<Option<Vec<u8>>>
where
    R: AsyncBufRead + Unpin,
{
    let mut content_length: Option<usize> = None;
    let mut header_line = String::new();
    loop {
        header_line.clear();
        let n = reader.read_line(&mut header_line).await?;
        if n == 0 {
            // EOF before headers complete.
            return Ok(None);
        }
        // End of headers: empty line "\r\n" or "\n".
        let trimmed = header_line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = Some(value.trim().parse().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidData, "invalid Content-Length")
                })?);
            }
            // Other headers (e.g., Content-Type) are ignored by spec.
        }
    }
    let len = content_length.ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length header")
    })?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await?;
    Ok(Some(body))
}

/// Write JSON bytes as one framed message to `writer`.
pub async fn write_frame<W>(writer: &mut W, body: &[u8]) -> io::Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    writer.write_all(header.as_bytes()).await?;
    writer.write_all(body).await?;
    writer.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[tokio::test]
    async fn reads_basic_frame() {
        let raw = b"Content-Length: 17\r\n\r\n{\"hello\":\"world\"}";
        let mut reader = BufReader::new(&raw[..]);
        let body = read_frame(&mut reader).await.unwrap().unwrap();
        assert_eq!(body, br#"{"hello":"world"}"#);
    }

    #[tokio::test]
    async fn reads_two_frames_in_sequence() {
        let raw = b"Content-Length: 2\r\n\r\n{}Content-Length: 5\r\n\r\n[1,2]";
        let mut reader = BufReader::new(&raw[..]);
        assert_eq!(read_frame(&mut reader).await.unwrap().unwrap(), b"{}");
        assert_eq!(read_frame(&mut reader).await.unwrap().unwrap(), b"[1,2]");
    }

    #[tokio::test]
    async fn ignores_content_type_header() {
        let raw = b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: 2\r\n\r\n{}";
        let mut reader = BufReader::new(&raw[..]);
        let body = read_frame(&mut reader).await.unwrap().unwrap();
        assert_eq!(body, b"{}");
    }

    #[tokio::test]
    async fn missing_content_length_errors() {
        let raw = b"Content-Type: foo\r\n\r\n{}";
        let mut reader = BufReader::new(&raw[..]);
        let err = read_frame(&mut reader).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn clean_eof_returns_none() {
        let raw: &[u8] = b"";
        let mut reader = BufReader::new(raw);
        assert!(read_frame(&mut reader).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn write_frame_includes_correct_header() {
        let mut buf: Vec<u8> = Vec::new();
        write_frame(&mut buf, br#"{"x":1}"#).await.unwrap();
        assert_eq!(buf, b"Content-Length: 7\r\n\r\n{\"x\":1}");
    }

    #[tokio::test]
    async fn round_trip_preserves_bytes() {
        let payload = br#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let mut buf: Vec<u8> = Vec::new();
        write_frame(&mut buf, payload).await.unwrap();
        let mut reader = BufReader::new(&buf[..]);
        let decoded = read_frame(&mut reader).await.unwrap().unwrap();
        assert_eq!(decoded, payload);
    }
}
