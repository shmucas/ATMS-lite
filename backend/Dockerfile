FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY intersections.docker.json ./intersections.json

ENV ATMS_INTERSECTIONS=/app/intersections.json \
    ATMS_POLL_HZ=5 \
    ATMS_CORS_ORIGINS=http://localhost:8080

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
