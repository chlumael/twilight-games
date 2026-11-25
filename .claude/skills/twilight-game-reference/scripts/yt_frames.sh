#!/bin/bash
# Collect YouTube auto-generated frames (25/50/75% of each video) for a search query.
# Usage: yt_frames.sh <outdir> <nvideos> "<query>" [any|medium]
#   medium = only 4-20 minute videos (skips Shorts, which are mostly edited clips)
# Writes <outdir>/<videoId>_<1-3>.jpg, ids.txt, and <outdir>.png contact sheet.
set -u
out=$1; n=$2; q=$3; len=${4:-medium}; here=$(dirname "$0"); mkdir -p "$out"
enc=$(python3 -I -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$q")
sp=""; [ "$len" = medium ] && sp="&sp=EgIYAw%253D%253D"
ids=$(curl -s --max-time 20 -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130' -H 'Accept-Language: ko-KR' \
  "https://www.youtube.com/results?search_query=$enc$sp" | grep -oE '"videoId":"[A-Za-z0-9_-]{11}"' | cut -d'"' -f4 | awk '!s[$0]++' | head -n "$n")
files=()
for id in $ids; do for k in 1 2 3; do
  f="$out/${id}_$k.jpg"; curl -s --max-time 10 -o "$f" "https://i.ytimg.com/vi/$id/hq$k.jpg" && files+=("$f")
done; done
echo "$ids" > "$out/ids.txt"
python3 -I "$here/contact_sheet.py" "$out.png" "${files[@]}"
