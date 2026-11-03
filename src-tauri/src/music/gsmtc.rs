//! Windows: the playing song from the system media controls (the same source as
//! the volume flyout), which Spotify, browsers, iTunes and most players feed.

use super::{ArtSource, SystemTrack};
use crate::model::music::NowPlaying;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;

/// Largest cover read.
const MAX_ART: u64 = 5 * 1024 * 1024;
/// 100 ns ticks between 1601 and 1970.
const EPOCH_TICKS: i64 = 116_444_736_000_000_000;

#[derive(Default)]
pub struct Reader {
    last_key: String,
    /// A song whose cover couldn't be read yet; tried once more.
    retry_key: String,
}

fn read_art(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<ArtSource> {
    let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > MAX_ART {
        return None;
    }
    let mime = stream
        .ContentType()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size as u32).ok()?.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(ArtSource::Bytes {
        mime: if mime.starts_with("image/") {
            mime
        } else {
            "image/png".into()
        },
        bytes,
    })
}

fn read_now(last_key: &str) -> windows::core::Result<Option<SystemTrack>> {
    let manager = Manager::RequestAsync()?.join()?;
    let Ok(session) = manager.GetCurrentSession() else {
        return Ok(None);
    };
    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    let title = props.Title()?.to_string();
    if title.is_empty() {
        return Ok(None);
    }
    let playing = session.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;
    let timeline = session.GetTimelineProperties()?;
    let ticks = |t: windows::Foundation::TimeSpan| (t.Duration.max(0) / 10_000) as u64;
    let mut progress = ticks(timeline.Position()?);
    let duration = ticks(timeline.EndTime()?).saturating_sub(ticks(timeline.StartTime()?));
    // Players only report the position now and then; add the time since.
    if playing && let Ok(updated) = timeline.LastUpdatedTime() {
        let now = crate::util::now_ms() * 10_000 + EPOCH_TICKS;
        let since = ((now - updated.UniversalTime).max(0) / 10_000) as u64;
        progress += since;
    }
    if duration > 0 {
        progress = progress.min(duration);
    }
    let mut track = NowPlaying {
        id: String::new(),
        title,
        artist: props.Artist()?.to_string(),
        album: props.AlbumTitle()?.to_string(),
        art_url: String::new(),
        playing,
        progress_ms: progress,
        duration_ms: duration,
    };
    track.id = track.key();
    let player = session
        .SourceAppUserModelId()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let art = (track.id != last_key).then(|| read_art(&props)).flatten();
    Ok(Some(SystemTrack {
        player: player
            .rsplit(['\\', '!'])
            .next()
            .unwrap_or_default()
            .trim_end_matches(".exe")
            .to_string(),
        art,
        track,
    }))
}

impl Reader {
    pub async fn read(&mut self) -> Result<Option<SystemTrack>, String> {
        let last = self.last_key.clone();
        let got = tokio::task::spawn_blocking(move || read_now(&last))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("Couldn't read the Windows media controls: {e}"))?;
        if let Some(t) = &got
            && t.track.id != self.last_key
        {
            if t.art.is_some() || t.track.id == self.retry_key {
                self.last_key = t.track.id.clone();
            } else {
                self.retry_key = t.track.id.clone();
            }
        }
        Ok(got)
    }
}
