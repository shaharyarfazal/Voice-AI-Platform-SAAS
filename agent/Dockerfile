FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY agent.py setup_sip.py ./
# Bake the VAD and turn-detector model weights into the image so calls don't wait on downloads.
RUN python -m livekit.agents download-files

CMD ["python", "-m", "livekit.agents", "start", "agent.py"]
