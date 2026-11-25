#!/usr/bin/env python3
"""답변을 마치기 전에 마지막 답변이 한국어인지 검사한다.

코드 블록·인라인 코드·주소·파일 경로를 뺀 나머지에서 한글이 너무 적고
영어 글자가 많으면 종료를 막고 한국어로 다시 쓰게 한다.
한 번 막힌 뒤(stop_hook_active)에는 다시 막지 않아 무한 반복을 피한다.
"""
import json
import re
import sys


def last_assistant_text(path):
    texts = []
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return ""
    # 뒤에서부터: 마지막 사용자 입력(도구 결과 제외) 이후의 어시스턴트 글만 모은다.
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        msg = entry.get("message") or {}
        content = msg.get("content")
        if entry.get("type") == "user":
            if isinstance(content, str):
                break
            if isinstance(content, list) and any(
                isinstance(b, dict) and b.get("type") == "text" for b in content
            ):
                break
            continue
        if entry.get("type") != "assistant" or not isinstance(content, list):
            continue
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text":
                texts.append(b.get("text", ""))
        if texts:
            # 최종 답변 한 덩어리만 보면 충분하다.
            break
    return "\n".join(reversed(texts))


def strip_noise(text):
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"`[^`\n]*`", " ", text)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\S*/\S*", " ", text)  # 파일 경로
    return text


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    if data.get("stop_hook_active"):
        return
    text = data.get("last_assistant_message")
    if not isinstance(text, str) or not text.strip():
        text = last_assistant_text(data.get("transcript_path", ""))
    body = strip_noise(text or "")
    hangul = len(re.findall(r"[가-힣]", body))
    latin = len(re.findall(r"[A-Za-z]", body))
    # 한글 한 글자 ≈ 영어 2~3글자. 영어가 한글의 3배를 넘으면 영어 답변으로 본다.
    if latin >= 60 and latin > hangul * 3:
        print(json.dumps({
            "decision": "block",
            "reason": "방금 답변이 영어로 작성됐습니다. 사용자는 영어를 읽지 못합니다. "
                      "같은 내용을 처음부터 한국어로 다시 작성하세요(코드·명령어·파일 이름만 영어 허용).",
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
