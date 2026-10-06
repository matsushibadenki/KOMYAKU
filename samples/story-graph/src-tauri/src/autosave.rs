//! One host-owned writer: debounce bursts, bound continuous delays, drain on exit.
use std::{
    sync::{Arc, Condvar, Mutex},
    thread::JoinHandle,
    time::{Duration, Instant},
};
#[derive(Default)]
struct Pending {
    requested: u64,
    completed: u64,
    first: Option<Instant>,
    deadline: Option<Instant>,
    stopping: bool,
    error: Option<String>,
}
pub struct Worker {
    shared: Arc<(Mutex<Pending>, Condvar)>,
    thread: Mutex<Option<JoinHandle<()>>>,
}
impl Worker {
    pub fn new(
        mut save: impl FnMut() -> Result<(), String> + Send + 'static,
    ) -> std::io::Result<Self> {
        let shared = Arc::new((Mutex::new(Pending::default()), Condvar::new()));
        let state = shared.clone();
        let thread = std::thread::Builder::new()
            .name("story-autosave".into())
            .spawn(move || {
                let (lock, wake) = &*state;
                loop {
                    let mut pending = lock.lock().unwrap();
                    while pending.completed == pending.requested && !pending.stopping {
                        pending = wake.wait(pending).unwrap();
                    }
                    if pending.completed == pending.requested && pending.stopping {
                        break;
                    }
                    if !pending.stopping
                        && let Some(deadline) = pending.deadline
                        && deadline > Instant::now()
                    {
                        let _ = wake
                            .wait_timeout(
                                pending,
                                deadline.saturating_duration_since(Instant::now()),
                            )
                            .unwrap();
                        continue;
                    }
                    let target = pending.requested;
                    pending.first = None;
                    pending.deadline = None;
                    drop(pending);
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(&mut save))
                        .unwrap_or_else(|_| Err("save_failed".into()));
                    let mut pending = lock.lock().unwrap();
                    pending.completed = target;
                    pending.error = result.err();
                    wake.notify_all();
                }
            })?;
        Ok(Self {
            shared,
            thread: Mutex::new(Some(thread)),
        })
    }
    pub fn request(&self) {
        let (lock, wake) = &*self.shared;
        let mut pending = lock.lock().unwrap();
        if pending.stopping {
            return;
        }
        pending.requested += 1;
        let now = Instant::now();
        let first = *pending.first.get_or_insert(now);
        pending.deadline =
            Some((now + Duration::from_millis(180)).min(first + Duration::from_secs(1)));
        wake.notify_all();
    }
    pub fn flush(&self) -> Result<(), String> {
        let (lock, wake) = &*self.shared;
        let mut pending = lock.lock().unwrap();
        if pending.error.is_some() && !pending.stopping {
            pending.requested += 1;
        }
        let target = pending.requested;
        pending.deadline = Some(Instant::now());
        wake.notify_all();
        while pending.completed < target {
            pending = wake.wait(pending).unwrap();
        }
        pending.error.clone().map_or(Ok(()), Err)
    }
    pub fn shutdown(&self) -> Result<(), String> {
        let (lock, wake) = &*self.shared;
        {
            let mut pending = lock.lock().unwrap();
            pending.stopping = true;
            wake.notify_all();
        }
        if let Some(thread) = self.thread.lock().unwrap().take() {
            thread.join().map_err(|_| "save_failed".to_string())?;
        }
        lock.lock().unwrap().error.clone().map_or(Ok(()), Err)
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flush_persists_the_latest_document_and_allows_more_edits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.story.json");
        let current = Arc::new(Mutex::new(unge_core::Document::default()));
        let source = current.clone();
        let destination = path.clone();
        let worker =
            Worker::new(move || crate::save(&destination, &source.lock().unwrap())).unwrap();
        for i in 0..100 {
            current.lock().unwrap().title = format!("版{i}");
            worker.request();
        }
        worker.flush().unwrap();
        assert_eq!(crate::load(&path).unwrap().title, "版99");
        current.lock().unwrap().title = "最終版".into();
        worker.request();
        worker.shutdown().unwrap();
        assert_eq!(crate::load(&path).unwrap().title, "最終版");
    }
    #[test]
    fn continuous_requests_cannot_starve_the_writer() {
        let (sent, received) = std::sync::mpsc::channel();
        let worker = Arc::new(
            Worker::new(move || {
                let _ = sent.send(());
                Ok(())
            })
            .unwrap(),
        );
        let producer = worker.clone();
        let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop = stopped.clone();
        let thread = std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                producer.request();
                std::thread::sleep(Duration::from_millis(20));
            }
        });
        let saved = received.recv_timeout(Duration::from_secs(3));
        stopped.store(true, Ordering::SeqCst);
        thread.join().unwrap();
        worker.shutdown().unwrap();
        assert!(saved.is_ok());
    }
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[test]
    fn burst_is_coalesced_and_shutdown_drains_without_waiting_for_debounce() {
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        let main = std::thread::current().id();
        let worker = Worker::new(move || {
            assert_ne!(main, std::thread::current().id());
            c.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
        for _ in 0..100 {
            worker.request();
        }
        worker.shutdown().unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn changes_during_an_active_write_get_a_second_save_and_errors_can_recover() {
        let (started, wait) = std::sync::mpsc::channel();
        let (release, resume) = std::sync::mpsc::channel();
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        let worker = Worker::new(move || {
            let n = c.fetch_add(1, Ordering::SeqCst);
            if n == 0 {
                started.send(()).unwrap();
                resume.recv().unwrap();
                return Err("save_failed".into());
            }
            Ok(())
        })
        .unwrap();
        worker.request();
        wait.recv_timeout(Duration::from_secs(2)).unwrap();
        worker.request();
        release.send(()).unwrap();
        worker.shutdown().unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }
    #[test]
    fn failed_save_is_reported_on_shutdown() {
        let worker = Worker::new(|| Err("save_failed".into())).unwrap();
        worker.request();
        assert_eq!(worker.shutdown().unwrap_err(), "save_failed");
    }
    #[test]
    fn failed_flush_can_retry_without_stopping_the_worker() {
        let mut failed = true;
        let worker = Worker::new(move || {
            if failed {
                failed = false;
                Err("save_failed".into())
            } else {
                Ok(())
            }
        })
        .unwrap();
        worker.request();
        assert_eq!(worker.flush().unwrap_err(), "save_failed");
        worker.flush().unwrap();
        worker.request();
        worker.shutdown().unwrap();
    }
}
