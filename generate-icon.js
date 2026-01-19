const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, 'images', 'icon-simple.svg');
const pngPath = path.join(__dirname, 'images', 'icon.png');

// Read SVG and convert to PNG
const svgBuffer = fs.readFileSync(svgPath);

sharp(svgBuffer)
    .resize(128, 128)
    .png()
    .toFile(pngPath)
    .then(() => {
        console.log('✅ PNG icon generated successfully: images/icon.png');
    })
    .catch(err => {
        console.error('❌ Error generating PNG:', err);
    });
