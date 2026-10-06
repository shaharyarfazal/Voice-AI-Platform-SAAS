"""Converts the session recording (Ogg/Opus, written by LiveKit Agents) to MP3 for clients."""

from __future__ import annotations

from pathlib import Path

import av


def to_mp3(source: Path, target: Path, bitrate: int = 64_000) -> Path:
    """Re-encodes caller (left) and agent (right) as a stereo 64 kbps MP3, about 0.5 MB a minute."""
    with av.open(str(source)) as src, av.open(str(target), mode="w", format="mp3") as dst:
        out = dst.add_stream("libmp3lame", rate=24000)
        out.bit_rate = bitrate
        out.layout = "stereo"
        resampler = av.AudioResampler(format="s16p", layout="stereo", rate=24000)
        for frame in src.decode(audio=0):
            for resampled in resampler.resample(frame):
                for packet in out.encode(resampled):
                    dst.mux(packet)
        for resampled in resampler.resample(None):
            for packet in out.encode(resampled):
                dst.mux(packet)
        for packet in out.encode(None):
            dst.mux(packet)
    return target
