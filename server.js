// server.js
const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3022;

// Конфигурация
app.use(fileUpload({
    limits: { fileSize: 100 * 1024 * 1024 },
    abortOnLimit: true,
    useTempFiles: true,
    tempFileDir: path.join(__dirname, 'temp/')
}));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Пути
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

// Заголовок BTX (пример, уточните точные байты)
const BTX_HEADER = Buffer.from([0x4B, 0x54, 0x58, 0x11]); 

// Создание директорий
[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Роуты
app.get('/', (req, res) => {
    res.render('index', {
        message: null,
        success: false,
        downloadLinks: [],
        conversionType: 'btx2png'
    });
});

app.post('/convert', async (req, res) => {
    const conversionType = req.body.conversionType || 'btx2png';
    
    if (!req.files?.files) {
        return res.status(400).render('index', {
            message: 'No files uploaded',
            success: false,
            downloadLinks: [],
            conversionType
        });
    }

    const files = Array.isArray(req.files.files) 
        ? req.files.files 
        : [req.files.files];

    const results = [];
    const errors = [];

    for (const file of files) {
        try {
            const result = await (conversionType === 'btx2png' 
                ? convertBtxToPng(file) 
                : convertPngToBtx(file));
            
            results.push(result);
        } catch (err) {
            errors.push({
                file: file.name,
                error: err.message
            });
        }
    }

    res.render('index', {
        message: results.length > 0 
            ? `Converted ${results.length}/${files.length} files` 
            : 'All conversions failed',
        success: results.length > 0,
        downloadLinks: results,
        conversionType
    });
});

async function convertBtxToPng(file) {
    const originalName = path.parse(file.name).name;
    const tempDir = path.join(UPLOAD_DIR, uuidv4());
    fs.mkdirSync(tempDir);

    try {
        const tempBtxPath = path.join(tempDir, file.name);
        const ktxPath = path.join(tempDir, `${originalName}.ktx`);
        const outputPath = path.join(OUTPUT_DIR, `${originalName}.png`);

        await file.mv(tempBtxPath);
        
        // Удаляем заголовок BTX
        const fileData = fs.readFileSync(tempBtxPath);
        fs.writeFileSync(ktxPath, fileData.subarray(4));

        await executeConversion(
            `-i "${ktxPath}" -d "${outputPath}" -ft png`,
            outputPath
        );

        return {
            name: `${originalName}.png`,
            path: outputPath
        };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function convertPngToBtx(file) {
    const originalName = path.parse(file.name).name;
    const tempDir = path.join(UPLOAD_DIR, uuidv4());
    fs.mkdirSync(tempDir);

    try {
        const pngPath = path.join(tempDir, file.name);
        const ktxPath = path.join(tempDir, `${originalName}.ktx`);
        const outputPath = path.join(OUTPUT_DIR, `${originalName}.btx`);

        await file.mv(pngPath);
        
        // Конвертируем PNG в KTX
        await executeConversion(
            `-i "${pngPath}" -d "${ktxPath}" -ft ktx`,
            ktxPath
        );

        // Добавляем заголовок BTX
        const ktxData = fs.readFileSync(ktxPath);
        const btxData = Buffer.concat([BTX_HEADER, ktxData]);
        fs.writeFileSync(outputPath, btxData);

        return {
            name: `${originalName}.btx`,
            path: outputPath
        };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function executeConversion(args, outputPath) {
    return new Promise((resolve, reject) => {
        exec(
            `"${process.env.PVR_TEX_TOOL_PATH || './PVRTexToolCLI'}" ${args}`,
            { timeout: 30000 },
            (error, stdout, stderr) => {
                if (error || !fs.existsSync(outputPath)) {
                    reject(new Error(stderr || 'Conversion failed'));
                } else {
                    resolve();
                }
            }
        );
    });
}

app.get('/download/:filename', (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(OUTPUT_DIR, filename);

    if (fs.existsSync(filePath)) {
        res.download(filePath, filename, err => {
            if (err) console.error('Download error:', err);
            fs.unlinkSync(filePath);
        });
    } else {
        res.status(404).render('index', {
            message: 'File not found',
            success: false,
            downloadLinks: []
        });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});