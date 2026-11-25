#!/usr/bin/env bash
# 사용자가 메시지를 보낼 때마다 "한국어로만 답하라"는 안내를 Claude에게 다시 전달한다.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"[필수 규칙] 이 사용자에게 보내는 모든 답변·보고·요약·질문은 반드시 한국어로만 작성한다. 사용자는 코딩을 모르고 영어를 읽지 못한다. 코드·명령어·파일 이름만 영어로 둔다. 영어 용어를 쓸 때는 한국어로 풀어서 설명한다. [진행 문서] 결정·요청을 받거나 버전 게시·작업을 끝내면 진행 문서(CLAUDE.md의 링크)를 최신으로 갱신한다."}}
JSON
