const fs = require('fs');
let code = fs.readFileSync('ui.js', 'utf-8');
code = code.split('\\`').join('`');
code = code.split('\\$').join('$');
fs.writeFileSync('ui.js', code);
