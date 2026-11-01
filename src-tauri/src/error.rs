use serde::Serialize;

/// Errors returned to the app window. `message` is written for the user.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    User(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("OBS: {0}")]
    Obs(String),
    #[error("Twitch: {0}")]
    Twitch(String),
    #[error("Couldn't read or write a file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Network: {0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::User(_) => "user",
            AppError::NotFound(_) => "not_found",
            AppError::Obs(_) => "obs",
            AppError::Twitch(_) => "twitch",
            AppError::Io(_) => "io",
            AppError::Json(_) => "json",
            AppError::Db(_) => "db",
            AppError::Http(_) => "http",
            AppError::Other(_) => "other",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

pub fn user_err<T>(msg: impl Into<String>) -> AppResult<T> {
    Err(AppError::User(msg.into()))
}
