/**
 * Generate Android launcher icons + splash images from public/mafitapay-logo.png
 * Uses pure Node (no sharp). Prefers `jimp` if installed.
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const logoPath = path.join(root, 'public', 'mafitapay-logo.png')
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res')
const brandBackground = 0x0c0907ff
/** Inset so the M logo stays inside the adaptive safe zone (not edge-to-edge). */
const ICON_PAD_RATIO = 0.2

const iconSizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
}

const splashSizes = {
  drawable: [480, 320],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
}

async function loadJimp() {
  try {
    const require = createRequire(import.meta.url)
    return require('jimp')
  } catch {
    return null
  }
}

async function generateWithJimp(Jimp) {
  const { Jimp: JimpClass, JimpMime } = Jimp
  const sourceLogo = await JimpClass.read(logoPath)
  const squareSide = Math.max(sourceLogo.bitmap.width, sourceLogo.bitmap.height)
  const squareLogo = new JimpClass({ width: squareSide, height: squareSide, color: brandBackground })
  const offsetX = Math.floor((squareSide - sourceLogo.bitmap.width) / 2)
  const offsetY = Math.floor((squareSide - sourceLogo.bitmap.height) / 2)
  squareLogo.composite(sourceLogo, offsetX, offsetY)

  for (const [folder, size] of Object.entries(iconSizes)) {
    const targetDir = path.join(resDir, folder)
    await mkdir(targetDir, { recursive: true })
    const pad = Math.round(size * ICON_PAD_RATIO)
    const logoSize = Math.max(1, size - pad * 2)
    const icon = new JimpClass({ width: size, height: size, color: brandBackground })
    const scaledLogo = squareLogo.clone().resize({ w: logoSize, h: logoSize })
    icon.composite(scaledLogo, pad, pad)
    const buffer = await icon.getBuffer(JimpMime.png)
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      await writeFile(path.join(targetDir, name), buffer)
    }
  }

  for (const [folder, [width, height]] of Object.entries(splashSizes)) {
    const targetDir = path.join(resDir, folder)
    await mkdir(targetDir, { recursive: true })
    const logoSize = Math.round(Math.min(width, height) * 0.32)
    const centeredLogo = squareLogo.clone().resize({ w: logoSize, h: logoSize })
    const splash = new JimpClass({ width, height, color: brandBackground })
    splash.composite(
      centeredLogo,
      Math.floor((width - logoSize) / 2),
      Math.floor((height - logoSize) / 2),
    )
    await writeFile(path.join(targetDir, 'splash.png'), await splash.getBuffer(JimpMime.png))
  }
}

/** Fallback: copy logo into icon slots (Android scales). Splash = solid dark with logo via PowerShell if available. */
async function generateFallback() {
  const logo = await readFile(logoPath)
  for (const folder of Object.keys(iconSizes)) {
    const targetDir = path.join(resDir, folder)
    await mkdir(targetDir, { recursive: true })
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      await writeFile(path.join(targetDir, name), logo)
    }
  }
  // Best-effort PowerShell resize for splash + icons on Windows
  const ps = `
Add-Type -AssemblyName System.Drawing
$logoPath = '${logoPath.replace(/\\/g, '\\\\')}'
$src = [System.Drawing.Image]::FromFile($logoPath)
function Save-Square($size, $out) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(255,12,9,7))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $pad = [int]($size * 0.20)
  $g.DrawImage($src, $pad, $pad, $size - 2*$pad, $size - 2*$pad)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
function Save-Splash($w, $h, $out) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(255,12,9,7))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $side = [Math]::Min($w,$h) * 0.32
  $x = ($w - $side) / 2
  $y = ($h - $side) / 2
  $g.DrawImage($src, $x, $y, $side, $side)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$res = '${resDir.replace(/\\/g, '\\\\')}'
@(
  @{f='mipmap-mdpi';s=48},
  @{f='mipmap-hdpi';s=72},
  @{f='mipmap-xhdpi';s=96},
  @{f='mipmap-xxhdpi';s=144},
  @{f='mipmap-xxxhdpi';s=192}
) | ForEach-Object {
  $dir = Join-Path $res $_.f
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  foreach ($n in @('ic_launcher.png','ic_launcher_round.png','ic_launcher_foreground.png')) {
    Save-Square $_.s (Join-Path $dir $n)
  }
}
@(
  @{f='drawable';w=480;h=320},
  @{f='drawable-port-mdpi';w=320;h=480},
  @{f='drawable-port-hdpi';w=480;h=800},
  @{f='drawable-port-xhdpi';w=720;h=1280},
  @{f='drawable-port-xxhdpi';w=960;h=1600},
  @{f='drawable-port-xxxhdpi';w=1280;h=1920},
  @{f='drawable-land-mdpi';w=480;h=320},
  @{f='drawable-land-hdpi';w=800;h=480},
  @{f='drawable-land-xhdpi';w=1280;h=720},
  @{f='drawable-land-xxhdpi';w=1600;h=960},
  @{f='drawable-land-xxxhdpi';w=1920;h=1280}
) | ForEach-Object {
  $dir = Join-Path $res $_.f
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Save-Splash $_.w $_.h (Join-Path $dir 'splash.png')
}
$src.Dispose()
Write-Output 'ps_branding_ok'
`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.status === 0 && String(result.stdout).includes('ps_branding_ok')) {
    console.log('Generated MafitaPay Android icons and splash via PowerShell.')
    return
  }
  console.warn('PowerShell branding failed; used logo copies for icons.', result.stderr || result.stdout)
  console.log('Generated basic Android icons from logo (fallback).')
}

await access(logoPath)
const jimp = await loadJimp()
if (jimp?.Jimp) {
  await generateWithJimp(jimp)
  console.log('Generated MafitaPay Android icons and splash via jimp.')
} else {
  await generateFallback()
}

// Adaptive icon bg
const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0c0907</color>
</resources>
`
await mkdir(path.join(resDir, 'values'), { recursive: true })
await writeFile(path.join(resDir, 'values', 'ic_launcher_background.xml'), bgXml)
