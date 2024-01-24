use rust_team_data::v1::{TeamKind, Teams, BASE_URL};
use std::error::Error;

fn teams() -> Result<Teams, Box<dyn Error>> {
    let url = format!("{BASE_URL}/teams.json");
    let mut teams: Teams = reqwest::blocking::get(&url)?.error_for_status()?.json()?;
    teams.teams.retain(|k, v| match v.kind {
        TeamKind::Team | TeamKind::WorkingGroup | TeamKind::ProjectGroup => true,
        TeamKind::MarkerTeam => false,
        TeamKind::Unknown => panic!("unknown team kind for {k}"),
    });
    Ok(teams)
}

fn main() -> Result<(), Box<dyn Error>> {
    let teams = teams()?;
    let pretty = serde_json::to_string_pretty(&teams)?;
    std::fs::write("org-chart-data.js", format!("const RAW_TEAMS = {pretty};"))?;
    Ok(())
}
