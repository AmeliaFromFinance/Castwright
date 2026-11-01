#!/usr/bin/env bash
# Runs a throwaway OBS Studio on a virtual display for the integration tests.
#
#   run-obs.sh start     fresh config, start Xvfb + OBS, print the env to export
#   run-obs.sh restart   start OBS again with the same config (after kill)
#   run-obs.sh kill      kill OBS hard (Xvfb keeps running)
#   run-obs.sh stop      stop OBS and Xvfb
#
# Settings (env): OBS_TEST_DIR (default /tmp/castwright-obs-test),
# OBS_TEST_PORT (default: a free port), OBS_TEST_PASSWORD (default castwright-test),
# OBS_TEST_DISPLAY (default :99).
set -euo pipefail

DIR="${OBS_TEST_DIR:-/tmp/castwright-obs-test}"
PASSWORD="${OBS_TEST_PASSWORD:-castwright-test}"
DISPLAY_NUM="${OBS_TEST_DISPLAY:-:99}"
CFG="$DIR/config"
REC="$DIR/recordings"

free_port() {
    python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'
}

port_open() {
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

write_config() {
    local port="$1"
    rm -rf "$CFG" "$REC"
    mkdir -p "$CFG/obs-studio/basic/profiles/Test" "$CFG/obs-studio/basic/scenes" "$REC"

    cat >"$CFG/obs-studio/global.ini" <<EOF
[General]
Pre19Defaults=false
Pre21Defaults=false
Pre23Defaults=false
Pre24.1Defaults=false
FirstRun=true
LastVersion=503316482
ConfirmOnExit=false
EnableAutoUpdates=false
InfoIncrement=-1
WarnBeforeStartingStream=false
WarnBeforeStoppingStream=false
WarnBeforeStoppingRecord=false

[BasicWindow]
SysTrayEnabled=false
SysTrayWhenStarted=false

[Basic]
Profile=Test
ProfileDir=Test
SceneCollection=Test
SceneCollectionFile=Test

[OBSWebSocket]
FirstLoad=false
ServerEnabled=true
ServerPort=$port
AlertsEnabled=false
AuthRequired=true
ServerPassword=$PASSWORD
EOF

    cat >"$CFG/obs-studio/basic/profiles/Test/basic.ini" <<EOF
[General]
Name=Test

[Video]
BaseCX=1280
BaseCY=720
OutputCX=640
OutputCY=360
FPSType=0
FPSCommon=30

[Audio]
SampleRate=48000
ChannelSetup=Stereo

[Output]
Mode=Simple

[SimpleOutput]
FilePath=$REC
RecFormat2=mkv
RecQuality=Small
StreamEncoder=x264
RecEncoder=x264
VBitrate=1000
ABitrate=128
RecRB=true
RecRBTime=5
RecRBSize=64
EOF

    cat >"$CFG/obs-studio/basic/profiles/Test/service.json" <<'EOF'
{"type":"rtmp_custom","settings":{"server":"rtmp://127.0.0.1:1/live","key":"test"}}
EOF

    cat >"$CFG/obs-studio/basic/scenes/Test.json" <<'EOF'
{
  "name": "Test",
  "current_scene": "Scene A",
  "current_program_scene": "Scene A",
  "scene_order": [{"name": "Scene A"}, {"name": "Scene B"}],
  "sources": [
    {
      "id": "scene", "versioned_id": "scene", "name": "Scene A",
      "settings": {"id_counter": 2, "custom_size": false, "items": [
        {"name": "Red", "source_uuid": "", "id": 1, "visible": true, "locked": false,
         "pos": {"x": 0, "y": 0}, "scale": {"x": 1, "y": 1}, "align": 5, "bounds_type": 0},
        {"name": "Music", "id": 2, "visible": true, "locked": false,
         "pos": {"x": 0, "y": 0}, "scale": {"x": 1, "y": 1}, "align": 5, "bounds_type": 0}
      ]}
    },
    {
      "id": "scene", "versioned_id": "scene", "name": "Scene B",
      "settings": {"id_counter": 1, "custom_size": false, "items": [
        {"name": "Blue", "id": 1, "visible": true, "locked": false,
         "pos": {"x": 0, "y": 0}, "scale": {"x": 1, "y": 1}, "align": 5, "bounds_type": 0}
      ]}
    },
    {"id": "color_source", "versioned_id": "color_source_v3", "name": "Red",
     "settings": {"color": 4278190335, "width": 1280, "height": 720}},
    {"id": "color_source", "versioned_id": "color_source_v3", "name": "Blue",
     "settings": {"color": 4294901760, "width": 1280, "height": 720}},
    {"id": "ffmpeg_source", "versioned_id": "ffmpeg_source", "name": "Music",
     "settings": {"is_local_file": true, "local_file": ""}, "volume": 0.5}
  ],
  "transitions": [],
  "current_transition": "Fade",
  "transition_duration": 300,
  "groups": [],
  "quick_transitions": [],
  "modules": {}
}
EOF
    echo "$port" >"$DIR/port"
}

start_xvfb() {
    if [[ -f "$DIR/xvfb.pid" ]] && kill -0 "$(cat "$DIR/xvfb.pid")" 2>/dev/null; then
        return
    fi
    Xvfb "$DISPLAY_NUM" -screen 0 1280x800x24 -nolisten tcp >"$DIR/xvfb.log" 2>&1 &
    echo $! >"$DIR/xvfb.pid"
    sleep 1
}

start_obs() {
    local port
    port="$(cat "$DIR/port")"
    (
        DISPLAY="$DISPLAY_NUM" XDG_CONFIG_HOME="$CFG" LIBGL_ALWAYS_SOFTWARE=1 \
            exec obs --multi --disable-shutdown-check --disable-missing-files-check \
            --minimize-to-tray --collection Test --profile Test
    ) >"$DIR/obs.log" 2>&1 &
    echo $! >"$DIR/obs.pid"
    for _ in $(seq 1 120); do
        if port_open "$port"; then
            # the socket opens a little before OBS has loaded the scene collection
            sleep 2
            echo "export OBS_TEST_URL=ws://127.0.0.1:$port"
            echo "export OBS_TEST_PASSWORD=$PASSWORD"
            echo "export OBS_TEST_DIR=$DIR"
            return
        fi
        if ! kill -0 "$(cat "$DIR/obs.pid")" 2>/dev/null; then
            echo "OBS exited, see $DIR/obs.log" >&2
            exit 1
        fi
        sleep 0.5
    done
    echo "OBS didn't open port $port in time, see $DIR/obs.log" >&2
    exit 1
}

kill_obs() {
    if [[ -f "$DIR/obs.pid" ]]; then
        kill -9 "$(cat "$DIR/obs.pid")" 2>/dev/null || true
        rm -f "$DIR/obs.pid"
    fi
}

case "${1:-start}" in
start)
    kill_obs
    mkdir -p "$DIR"
    write_config "${OBS_TEST_PORT:-$(free_port)}"
    start_xvfb
    start_obs
    ;;
restart)
    kill_obs
    start_xvfb
    start_obs
    ;;
kill)
    kill_obs
    ;;
stop)
    kill_obs
    if [[ -f "$DIR/xvfb.pid" ]]; then
        kill "$(cat "$DIR/xvfb.pid")" 2>/dev/null || true
        rm -f "$DIR/xvfb.pid"
    fi
    ;;
*)
    echo "usage: $0 [start|restart|kill|stop]" >&2
    exit 2
    ;;
esac
