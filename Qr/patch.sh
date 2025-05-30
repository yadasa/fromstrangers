#!/usr/bin/env bash
#
# update_photos_js.sh
# Patches Qr/js/photos.js to:
#  • Remove Drive appProperties usage
#  • Show "From Strangers" placeholder, then overwrite with Firestore ownerName
#  • Gate delete logic on ownerPhone

FILE="/d/Users/itsst/Documents/WORK/fromstrangers/fromstrangers/Qr/js/photos.js"

# 1) sanity check
if [ ! -f "$FILE" ]; then
  echo "Error: File not found: $FILE"
  exit 1
fi

# 2) backup original (in case you need to revert)
cp "$FILE" "$FILE.bak"

# 3) remove any leftover appProperties?.ownerName / owner references
sed -i -E \
  -e 's/item\.appProperties\?\.(ownerName)/item.ownerName/g' \
  -e 's/item\.appProperties\?\.(owner)/item.ownerPhone/g' \
  "$FILE"

# 4) delete any lines that directly set "From ${…}" via template literals
sed -i -E "/\.innerText\s*=\s*\`From.*\`;/d" "$FILE"

# 5) inject placeholder + Firestore fetch after the date line in both render loops
sed -i -E "/cap\.appendChild\(document\.createElement\('div'\)\)\.innerText\s*=\s*new Date\(item\.createdTime\)\.toLocaleDateString\(\);/a \\
      // placeholder caption\n      const nameLine = document.createElement('div');\n      nameLine.innerText = 'From Strangers';\n      cap.appendChild(nameLine);\n      // Fetch ownerName from Firestore and overwrite placeholder\n      db.collection('photos').doc(item.id).get().then(docSnap => {\n        if (docSnap.exists()) {\n          const data = docSnap.data();\n          nameLine.innerText = \`From \${data.ownerName}\`;\n        }\n      }).catch(console.error);" \
  "$FILE"

# 6) switch delete-button logic and multi-select checks to ownerPhone
#    (any leftover patterns that still refer to item.ownerPhone in an if or filter)
sed -i -E \
  -e 's/if *\(item\.ownerPhone *=== *userPhone\)/if (item.ownerPhone === userPhone)/g' \
  -e 's/it\.appProperties\?\.(owner)/it.ownerPhone/g' \
  "$FILE"

echo "✅ photos.js patched. Original backed up at photos.js.bak"
