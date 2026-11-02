"""SkinLens backend: thin Flask proxy that keeps the YouCam API key server-side
and walks an uploaded selfie through Perfect Corp's skin-analysis pipeline:
init upload -> pre-signed PUT -> create v2.1 task -> poll -> results."""
import os
import time

import requests
from flask import Flask, jsonify, request, send_from_directory

API_BASE = os.environ.get("YOUCAM_API_BASE", "https://yce-api-01.makeupar.com/s2s")
API_KEY = os.environ.get("YOUCAM_API_KEY", "")

# One HD feature set (HD and SD actions cannot be mixed in one task).
HD_ACTIONS = [
    "hd_wrinkle", "hd_pore", "hd_texture", "hd_acne", "hd_redness",
    "hd_moisture", "hd_dark_circle", "hd_radiance",
]

app = Flask(__name__, static_folder="static", static_url_path="")


def auth_headers():
    return {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def safe_detail(resp):
    try:
        return resp.json()
    except ValueError:
        return {"text": resp.text[:400]}


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/status")
def status():
    return jsonify({"api_configured": bool(API_KEY)})


@app.route("/api/analyze", methods=["POST"])
def analyze():
    if not API_KEY:
        return jsonify({"error": "Server is missing its YouCam API key. Set YOUCAM_API_KEY in the hosting dashboard and redeploy."}), 503

    image = request.files.get("image")
    if image is None:
        return jsonify({"error": "No image received."}), 400
    data = image.read()
    if len(data) < 1024:
        return jsonify({"error": "Captured image looks empty. Retake the photo."}), 400

    # 1) Ask for an upload slot; the API returns a pre-signed URL + file_id.
    init = requests.post(
        f"{API_BASE}/v2.0/file",
        headers=auth_headers(),
        json={"files": [{
            "content_type": image.mimetype or "image/png",
            "file_name": "selfie_capture.png",
            "file_size": len(data),
        }]},
        timeout=30,
    )
    if init.status_code != 200:
        return jsonify({"error": f"Upload could not be initialised ({init.status_code}).", "detail": safe_detail(init)}), 502
    try:
        entry = init.json()["data"]["files"][0]
        file_id = entry["file_id"]
        upload = entry["requests"][0]
    except (KeyError, IndexError, TypeError, ValueError):
        return jsonify({"error": "Unexpected response while starting the upload.", "detail": safe_detail(init)}), 502

    # 2) Push the actual bytes to the pre-signed URL.
    put_headers = dict(upload.get("headers") or {})
    put_headers.setdefault("Content-Type", image.mimetype or "image/png")
    put = requests.put(upload["url"], data=data, headers=put_headers, timeout=120)
    if put.status_code not in (200, 201):
        return jsonify({"error": f"The image upload failed ({put.status_code})."}), 502

    # 3) Create the skin-analysis task (v2.1, JSON output).
    task = requests.post(
        f"{API_BASE}/v2.1/task/skin-analysis",
        headers=auth_headers(),
        json={"src_file_id": file_id, "dst_actions": HD_ACTIONS, "format": "json"},
        timeout=30,
    )
    if task.status_code != 200:
        return jsonify({"error": f"The analysis task could not be started ({task.status_code}).", "detail": safe_detail(task)}), 502
    task_id = task.json().get("data", {}).get("task_id")
    if not task_id:
        return jsonify({"error": "The analysis service did not return a task id.", "detail": safe_detail(task)}), 502

    # 4) Poll until success or error (engine time varies; units are only
    #    consumed on success).
    for _ in range(60):
        time.sleep(2)
        poll = requests.get(
            f"{API_BASE}/v2.1/task/skin-analysis/{task_id}",
            headers={"Authorization": f"Bearer {API_KEY}"},
            timeout=30,
        )
        if poll.status_code != 200:
            continue
        body = poll.json().get("data", {})
        state = body.get("status") or body.get("task_status")
        if state == "success":
            return jsonify(body), 200
        if state == "error":
            return jsonify({"error": "The analysis engine reported an error for this photo.", "detail": body}), 502
    return jsonify({"error": "Analysis is taking unusually long. Please try again."}), 504


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
