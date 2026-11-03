//! The app log: the last lines in memory for bug reports, and a few small files in
//! the data folder so the log survives a crash.

use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

pub const KEEP_LINES: usize = 2000;
pub const FILE_MAX_BYTES: u64 = 1024 * 1024;
pub const FILE_COUNT: usize = 3;

/// `castwright.log`, then `castwright.1.log` and so on, newest first.
pub fn file_path(dir: &Path, n: usize) -> PathBuf {
    if n == 0 {
        dir.join("castwright.log")
    } else {
        dir.join(format!("castwright.{n}.log"))
    }
}

pub struct RotatingFile {
    dir: PathBuf,
    max_bytes: u64,
    count: usize,
    file: Option<File>,
    size: u64,
}

impl RotatingFile {
    pub fn open(dir: &Path, max_bytes: u64, count: usize) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let mut f = RotatingFile {
            dir: dir.to_path_buf(),
            max_bytes,
            count: count.max(1),
            file: None,
            size: 0,
        };
        f.reopen()?;
        Ok(f)
    }

    fn reopen(&mut self) -> std::io::Result<()> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(file_path(&self.dir, 0))?;
        self.size = file.metadata()?.len();
        self.file = Some(file);
        Ok(())
    }

    pub fn write(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        if self.size > 0 && self.size + bytes.len() as u64 > self.max_bytes {
            self.rotate()?;
        }
        if self.file.is_none() {
            self.reopen()?;
        }
        if let Some(f) = self.file.as_mut() {
            f.write_all(bytes)?;
            self.size += bytes.len() as u64;
        }
        Ok(())
    }

    fn rotate(&mut self) -> std::io::Result<()> {
        // Windows can't rename a file that is still open.
        self.file = None;
        let _ = std::fs::remove_file(file_path(&self.dir, self.count - 1));
        for n in (0..self.count - 1).rev() {
            let from = file_path(&self.dir, n);
            if from.exists() {
                std::fs::rename(&from, file_path(&self.dir, n + 1))?;
            }
        }
        self.reopen()
    }
}

#[derive(Default)]
struct Inner {
    lines: VecDeque<String>,
    file: Option<RotatingFile>,
}

#[derive(Default)]
pub struct LogSink {
    inner: Mutex<Inner>,
}

impl LogSink {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Start writing to files in `dir`, beginning with what was logged so far.
    pub fn attach_dir(&self, dir: &Path) -> std::io::Result<()> {
        let mut file = RotatingFile::open(dir, FILE_MAX_BYTES, FILE_COUNT)?;
        let mut inner = self.lock();
        for line in &inner.lines {
            file.write(format!("{line}\n").as_bytes())?;
        }
        inner.file = Some(file);
        Ok(())
    }

    pub fn push(&self, text: &str) {
        let mut inner = self.lock();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            if let Some(f) = inner.file.as_mut()
                && f.write(format!("{line}\n").as_bytes()).is_err()
            {
                inner.file = None;
            }
            inner.lines.push_back(line.to_string());
            while inner.lines.len() > KEEP_LINES {
                inner.lines.pop_front();
            }
        }
    }

    pub fn lines(&self) -> Vec<String> {
        self.lock().lines.iter().cloned().collect()
    }

    /// The last `n` lines, or nothing if the log is busy (safe to call while panicking).
    pub fn try_tail(&self, n: usize) -> Vec<String> {
        match self.inner.try_lock() {
            Ok(inner) => {
                let skip = inner.lines.len().saturating_sub(n);
                inner.lines.iter().skip(skip).cloned().collect()
            }
            Err(_) => Vec::new(),
        }
    }
}

pub fn sink() -> &'static LogSink {
    static SINK: OnceLock<LogSink> = OnceLock::new();
    SINK.get_or_init(LogSink::default)
}

/// Hands `tracing` a writer that ends up in [`sink`].
pub struct Writer;

pub struct LineWriter(Vec<u8>);

impl Write for LineWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for LineWriter {
    fn drop(&mut self) {
        if !self.0.is_empty() {
            sink().push(&String::from_utf8_lossy(&self.0));
        }
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Writer {
    type Writer = LineWriter;

    fn make_writer(&'a self) -> Self::Writer {
        LineWriter(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(dir: &Path, n: usize) -> String {
        std::fs::read_to_string(file_path(dir, n)).unwrap_or_default()
    }

    #[test]
    fn rotates_and_keeps_three_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut f = RotatingFile::open(dir.path(), 100, 3).unwrap();
        for i in 0..20 {
            f.write(format!("line {i:02} ......................\n").as_bytes())
                .unwrap();
        }
        let names: Vec<_> = {
            let mut v: Vec<_> = std::fs::read_dir(dir.path())
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            v.sort();
            v
        };
        assert_eq!(
            names,
            ["castwright.1.log", "castwright.2.log", "castwright.log"]
        );
        for n in 0..3 {
            let len = std::fs::metadata(file_path(dir.path(), n)).unwrap().len();
            assert!(len <= 100, "file {n} is {len} bytes");
        }
        assert!(read(dir.path(), 0).contains("line 19"));
        assert!(read(dir.path(), 1).contains("line 16"));
        assert!(!read(dir.path(), 2).contains("line 00"), "oldest dropped");
    }

    #[test]
    fn appends_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        RotatingFile::open(dir.path(), 1000, 3)
            .unwrap()
            .write(b"first run\n")
            .unwrap();
        RotatingFile::open(dir.path(), 1000, 3)
            .unwrap()
            .write(b"second run\n")
            .unwrap();
        assert_eq!(read(dir.path(), 0), "first run\nsecond run\n");
    }

    #[test]
    fn a_single_long_line_still_gets_written() {
        let dir = tempfile::tempdir().unwrap();
        let mut f = RotatingFile::open(dir.path(), 10, 2).unwrap();
        f.write(b"short\n").unwrap();
        f.write(b"much longer than ten bytes\n").unwrap();
        assert_eq!(read(dir.path(), 0), "much longer than ten bytes\n");
        assert_eq!(read(dir.path(), 1), "short\n");
    }

    #[test]
    fn memory_keeps_the_last_lines() {
        let sink = LogSink::default();
        for i in 0..(KEEP_LINES + 5) {
            sink.push(&format!("line {i}\n"));
        }
        let lines = sink.lines();
        assert_eq!(lines.len(), KEEP_LINES);
        assert_eq!(lines[0], "line 5");
        assert_eq!(
            sink.try_tail(2),
            [
                format!("line {}", KEEP_LINES + 3),
                format!("line {}", KEEP_LINES + 4)
            ]
        );
    }

    #[test]
    fn attaching_writes_earlier_lines_to_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let sink = LogSink::default();
        sink.push("before\n");
        sink.attach_dir(dir.path()).unwrap();
        sink.push("after\n\n");
        assert_eq!(read(dir.path(), 0), "before\nafter\n");
    }
}
