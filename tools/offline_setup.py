#!/usr/bin/env python3
"""離線準備：把需要網路才能取得的檔案先下載到本資料夾（只需在有網路時執行一次）。
用法：python3 tools/offline_setup.py [--small]     （--small 只抓 YOLOv10n 小模型，不抓 YOLOv10s）
之後請用「啟動」腳本（本機伺服器）開啟，不要雙擊 index.html（離線的 WASM 需要 http://localhost）。"""
import os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/"
FILES = [
    (ORT + "ort.webgpu.min.js", "vendor/ort.webgpu.min.js"),
    (ORT + "ort-wasm-simd-threaded.jsep.wasm", "vendor/ort-wasm-simd-threaded.jsep.wasm"),
    (ORT + "ort-wasm-simd-threaded.jsep.mjs", "vendor/ort-wasm-simd-threaded.jsep.mjs"),
    ("https://huggingface.co/onnx-community/yolov10n/resolve/main/onnx/model.onnx", "models/yolov10n.onnx"),
]
if "--small" not in sys.argv:
    FILES.append(("https://huggingface.co/onnx-community/yolov10s/resolve/main/onnx/model.onnx", "models/yolov10s.onnx"))

for url, rel in FILES:
    dst = os.path.join(ROOT, rel)
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        print("已存在，略過：", rel); continue
    print("下載", rel, "…", flush=True)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "sociometry-offline-setup"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dst + ".part", "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b: break
            f.write(b)
    os.replace(dst + ".part", dst)
print("完成。接著請執行「啟動」腳本（或 python3 tools/serve.py）。")
