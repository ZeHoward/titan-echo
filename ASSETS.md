# 原創遊戲素材

使用內建 image_gen 工具產生，均已保存在本專案。

原始 PNG 放在 `art/`，**不隨網站發布**；`public/` 只放實際會被請求的 WebP 衍生檔。
先前 `public/` 同時放著兩者，發布產物 28MB 中有 20MB 是沒有任何程式碼會請求的原始 PNG。

- `art/battlefield.png`：直式翡翠森林戰場。
- `art/golem.png`：透明背景苔岩巨獸。
- `art/swordsman.png`：透明背景劍術大師。

## 最終提示詞

### battlefield.png
Create one portrait 1024x1536 original mobile fantasy tapping RPG game battlefield background artwork, no UI no text no characters no monsters. Stylized 2D hand painted cel-shaded whimsical fantasy like a beautiful polished 2015 mobile action RPG. Turquoise sky, distant floating stone islands, huge ancient trees and vines frame the sides, layered emerald mountain valley, a golden sunlit grassy circular fighting platform in the lower middle, small ancient carved stone ruins along the sides. Strong clean chunky shapes, vibrant jewel green and teal, gentle atmospheric haze. Center has clear open space for a large monster sprite, bottom foreground darker vegetation. Full bleed art, no borders, no letters.

### golem.png
Use case: stylized-concept. Asset type: original mobile tapping fantasy RPG enemy sprite. A single full-body enormous emerald moss stone golem, front facing, adorable but menacing, huge chunky arms with clenched fists, short thick legs, glowing amber eyes under craggy brow, small floating stones and leaves on shoulders, ancient angular stone armor and crystal core in chest. Professional 2D cel-shaded mobile game art with dark clean outlines, bold angular simple silhouettes, very readable at small size. Slight 3/4 perspective, complete body and feet fully visible, centered, fills 85% of canvas. Genuinely transparent background, no ground, no environment, no text, no border, no shadow outside feet. Square image.

### swordsman.png
Original fantasy tapping mobile RPG sword master sprite. Single full-body chibi young adult male hero viewed from behind in three quarter view, facing right towards an enemy. Spiky brown hair, teal-blue tunic, leather boots, long bright red scarf flowing left, oversized shining silver sword held diagonally upward to the right, ready to slash. Clean stylized 2D cel-shaded mobile game illustration, bold dark outline, chunky simple shapes. Whole body visible, isolated centered on genuinely transparent background, no scenery, no UI, no words, no border. Square canvas.

Performance derivatives: monsters*.webp, worlds-atlas.webp and swordsman.webp are generated from the corresponding `art/` PNGs with Pillow WebP quality 85, method 6. Dimensions and transparency are preserved.

```python
from PIL import Image
Image.open('art/<name>.png').save('public/<name>.webp', 'WEBP', quality=85, method=6)
```

swordsman.webp：972,366 → 159,518 位元組，1254×1254 RGBA 不變；合成到深色背景後與原圖的 RMS 差異 1.7、最大單點差 31，1,572,516 個像素中只有 32 個差異超過 24。
