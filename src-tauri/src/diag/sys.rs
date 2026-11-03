//! Small facts about this process and its folders.

use std::path::Path;

/// Memory the app process is using (resident set), when the OS makes it cheap to ask.
pub fn memory_bytes() -> Option<u64> {
    imp::memory_bytes()
}

#[cfg(target_os = "linux")]
mod imp {
    pub fn memory_bytes() -> Option<u64> {
        let status = std::fs::read_to_string("/proc/self/status").ok()?;
        let line = status.lines().find(|l| l.starts_with("VmRSS:"))?;
        let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
        Some(kb * 1024)
    }
}

#[cfg(windows)]
mod imp {
    #[repr(C)]
    #[derive(Default)]
    struct ProcessMemoryCounters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut core::ffi::c_void;
        fn K32GetProcessMemoryInfo(
            process: *mut core::ffi::c_void,
            counters: *mut ProcessMemoryCounters,
            cb: u32,
        ) -> i32;
    }

    pub fn memory_bytes() -> Option<u64> {
        let mut c = ProcessMemoryCounters {
            cb: std::mem::size_of::<ProcessMemoryCounters>() as u32,
            ..Default::default()
        };
        // SAFETY: GetCurrentProcess returns a pseudo handle that needs no closing, and
        // `c` is a correctly sized PROCESS_MEMORY_COUNTERS that lives for the call.
        let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) };
        (ok != 0).then_some(c.working_set_size as u64)
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod imp {
    pub fn memory_bytes() -> Option<u64> {
        None
    }
}

/// Total size of the files in `dir`, not following links.
pub fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        for e in entries.flatten() {
            let Ok(meta) = e.metadata() else { continue };
            let ft = meta.file_type();
            if ft.is_dir() {
                stack.push(e.path());
            } else if ft.is_file() {
                total += meta.len();
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_add_up() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a"), [0u8; 100]).unwrap();
        std::fs::create_dir_all(dir.path().join("b/c")).unwrap();
        std::fs::write(dir.path().join("b/c/d"), [0u8; 23]).unwrap();
        assert_eq!(dir_size(dir.path()), 123);
        assert_eq!(dir_size(&dir.path().join("missing")), 0);
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn memory_is_known() {
        assert!(memory_bytes().unwrap() > 1024 * 1024);
    }
}
