#!/usr/bin/env bash
set -e

## 1) Backup originals
cp css/style.css css/style.css.bak
cp js/photos.js  js/photos.js.bak
echo "Backups created: style.css.bak, photos.js.bak"

## 2) Append updated CSS to style.css
cat << 'EOF' >> css/style.css

/* === Gallery Card Overlay & Sizing Fixes === */
.photo-card {
  position: relative;
  aspect-ratio: 4 / 5;            /* a bit taller than square */
  overflow: hidden;
  border-radius: 0.5rem;
  box-shadow: var(--card-shadow);
}
.photo-card img {
  position: absolute;
  top: 0; left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-card .photo-caption {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 0.5rem;
  color: #fff;
  background: linear-gradient(
    to top,
    rgba(0,0,0,0.8) 0%,
    rgba(0,0,0,0.3) 50%,
    transparent 100%
  );
  display: flex;
  flex-direction: column;
  font-size: 0.8rem;
}
.photo-card .photo-caption .info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.25rem;
}
.photo-card .photo-caption .info-row .uploader {
  flex: 1;
}
.photo-card .photo-caption .info-row .heart {
  display: flex;
  align-items: center;
  font-size: 1rem;
}
.photo-card .photo-caption .info-row .heart.liked {
  color: red;
}
.photo-card .photo-caption .info-row .heart .count {
  margin-left: 0.25rem;
}
EOF

echo "✅ Appended overlay + sizing CSS to css/style.css"

## 3) Patch photos.js: insert overlay block after card.append(img);
perl -i -pe '
  BEGIN {
    $snippet = <<'"'"'SNIP'"'"';
    // --- bottom gradient overlay + date/uploader/hearts ---
    const overlay = document.createElement("div");
    overlay.className = "photo-caption";
    // Line 1: date only
    const dateLine = document.createElement("div");
    dateLine.innerText = new Date(item.createdTime).toLocaleDateString();
    overlay.append(dateLine);
    // Line 2: uploader + heart/count
    const infoRow = document.createElement("div");
    infoRow.className = "info-row";
    const uploader = document.createElement("div");
    uploader.className = "uploader";
    uploader.innerText = item.appProperties?.ownerName || "Stranger";
    infoRow.append(uploader);
    // Reuse your likeBtn state/count
    const heartDiv = document.createElement("div");
    heartDiv.className = "heart";
    const liked = likeBtn.dataset.liked === "true";
    heartDiv.classList.toggle("liked", liked);
    const count = parseInt(likeBtn.innerText.split(" ")[1] || "0", 10);
    heartDiv.innerHTML = (liked ? "♥" : "♡") + " <span class=\\"count\\">" + count + "</span>";
    heartDiv.onclick = () => likeBtn.click();
    infoRow.append(heartDiv);
    overlay.append(infoRow);
    card.append(overlay);
    // --- end overlay block ---
SNIP
  }
  # Insert snippet after the first occurrence of card.append(img);
  s/(card\.append\(img\);)/$1\n$snippet/ if $. == 1 .. eof
' js/photos.js

echo "✅ Patched js/photos.js with overlay creation block"

echo "🎉 All fixes applied. Please reload your app and verify the gradient overlay, date/uploader text, and heart/count now appear as expected."
