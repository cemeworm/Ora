use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const INSTANCE_LOCK_FILE: &str = "ora-desktop-instance.lock";

#[derive(Debug)]
pub struct DesktopInstanceLock {
    path: PathBuf,
    pid: u32,
}

#[derive(Debug)]
pub enum DesktopInstanceLockError {
    AlreadyRunning { pid: u32, path: PathBuf },
    Io(io::Error),
}

impl fmt::Display for DesktopInstanceLockError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyRunning { pid, path } => write!(
                formatter,
                "Another Ora desktop instance is already running for this data directory (pid {pid}, lock {}).",
                path.display()
            ),
            Self::Io(error) => write!(formatter, "Unable to acquire Ora desktop instance lock: {error}"),
        }
    }
}

impl std::error::Error for DesktopInstanceLockError {}

impl From<io::Error> for DesktopInstanceLockError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl DesktopInstanceLock {
    pub fn acquire(app_data_dir: &Path) -> Result<Self, DesktopInstanceLockError> {
        fs::create_dir_all(app_data_dir)?;
        let path = app_data_dir.join(INSTANCE_LOCK_FILE);
        let pid = std::process::id();

        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    writeln!(file, "{pid}")?;
                    return Ok(Self { path, pid });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    if let Some(existing_pid) = read_lock_pid(&path) {
                        if process_is_alive(existing_pid) {
                            return Err(DesktopInstanceLockError::AlreadyRunning {
                                pid: existing_pid,
                                path,
                            });
                        }
                    }
                    fs::remove_file(&path)?;
                }
                Err(error) => return Err(DesktopInstanceLockError::Io(error)),
            }
        }
    }
}

impl Drop for DesktopInstanceLock {
    fn drop(&mut self) {
        if read_lock_pid(&self.path) == Some(self.pid) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn read_lock_pid(path: &Path) -> Option<u32> {
    let raw = fs::read_to_string(path).ok()?;
    raw.trim().parse::<u32>().ok()
}

fn process_is_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .arg("-0")
        .arg(pid.to_string())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ora-instance-lock-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    #[test]
    fn acquire_creates_and_releases_lock() {
        let dir = temp_dir("acquire-release");
        let path = dir.join(INSTANCE_LOCK_FILE);

        {
            let _lock = DesktopInstanceLock::acquire(&dir).expect("lock should be acquired");
            assert_eq!(read_lock_pid(&path), Some(std::process::id()));
        }

        assert!(!path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn acquire_rejects_live_existing_owner() {
        let dir = temp_dir("live-owner");
        fs::write(dir.join(INSTANCE_LOCK_FILE), std::process::id().to_string())
            .expect("lock should be seeded");

        let error = DesktopInstanceLock::acquire(&dir).expect_err("live owner should be rejected");

        assert!(matches!(
            error,
            DesktopInstanceLockError::AlreadyRunning { pid, .. } if pid == std::process::id()
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn acquire_reclaims_stale_existing_owner() {
        let dir = temp_dir("stale-owner");
        let path = dir.join(INSTANCE_LOCK_FILE);
        fs::write(&path, "999999").expect("stale lock should be seeded");

        let _lock = DesktopInstanceLock::acquire(&dir).expect("stale lock should be reclaimed");

        assert_eq!(read_lock_pid(&path), Some(std::process::id()));
        let _ = fs::remove_dir_all(dir);
    }
}
