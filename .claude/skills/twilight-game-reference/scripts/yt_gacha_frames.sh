#!/usr/bin/env bash
# yt_gacha_frames.sh <출력 폴더> <영상 수> "<검색어>"
# 일반 영상(3~25분, 쇼츠 제외)만 골라 영상마다 자동 장면 3장(480x360)을 받고 <출력 폴더>.jpg 한 장으로 묶는다.
# 필요: pip install yt-dlp (검색에만 쓴다. 영상 자체 내려받기는 403으로 막혀 있다)
name=$1; n=$2; q=$3; mkdir -p $name
timeout 150 yt-dlp -q --no-warnings "ytsearch$((n*3)):$q" --match-filter "duration>180 & duration<1500" --max-downloads $n --print "%(id)s" --skip-download 2>/dev/null | head -$n > $name/ids.txt
i=0; while read id; do for k in 1 2 3; do curl -s --max-time 10 -o "$name/$(printf %02d $i)_$k.jpg" "https://i.ytimg.com/vi/$id/hq$k.jpg"; done; i=$((i+1)); done < $name/ids.txt
python3 -I - "$name" <<'PY'
import sys,glob
from PIL import Image,ImageDraw
d=sys.argv[1]; fs=sorted(glob.glob(d+'/*.jpg')); cols=6; w,h=320,240
o=Image.new('RGB',(cols*w,((len(fs)+cols-1)//cols)*h),'black'); dr=ImageDraw.Draw(o)
for k,f in enumerate(fs):
    try: im=Image.open(f).convert('RGB').resize((w,h))
    except Exception: continue
    o.paste(im,((k%cols)*w,(k//cols)*h)); dr.text(((k%cols)*w+4,(k//cols)*h+2),f.split('/')[-1][:-4],fill='yellow')
o.save(d+'.jpg',quality=80); print(d,len(fs),o.size)
PY
