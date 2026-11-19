$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assetDir = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $assetDir '..\..\..')).Path
$logoPath = Join-Path $repoRoot 'public\mafitapay-logo.png'
$iconPath = Join-Path $assetDir 'mafitapay-play-icon-512.png'
$featurePngPath = Join-Path $assetDir 'mafitapay-feature-graphic-1024x500.png'
$featureSvgPath = Join-Path $assetDir 'mafitapay-feature-graphic.svg'

function Convert-HexColor([string]$hex) {
  return [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function New-RoundedRectanglePath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-RoundedRectangle($graphics, [float]$x, [float]$y, [float]$width, [float]$height, [float]$radius, $fill, $stroke = $null, [float]$strokeWidth = 1) {
  $path = New-RoundedRectanglePath $x $y $width $height $radius
  if ($fill) { $graphics.FillPath($fill, $path) }
  if ($stroke) { $graphics.DrawPath($stroke, $path) }
  $path.Dispose()
}

# Store icon: use the source brand icon, preserving its existing artwork.
$logo = [System.Drawing.Image]::FromFile($logoPath)
$icon = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$iconGraphics = [System.Drawing.Graphics]::FromImage($icon)
$iconGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$iconGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$iconGraphics.DrawImage($logo, 0, 0, 512, 512)
$icon.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
$iconGraphics.Dispose()
$icon.Dispose()
$logo.Dispose()

# 1024 × 500 feature graphic; avoid a device frame or fabricated account data.
$bitmap = [System.Drawing.Bitmap]::new(1024, 500, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.Rectangle]::new(0, 0, 1024, 500),
  (Convert-HexColor '#0C0907'),
  (Convert-HexColor '#21180F'),
  0
)
$graphics.FillRectangle($background, 0, 0, 1024, 500)
$background.Dispose()

# Quiet brand-colored arcs and a soft green accent provide texture without competing with the copy.
$goldPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(42, 202, 165, 96), 2)
$greenPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(42, 72, 204, 120), 2)
$graphics.DrawArc($goldPen, 670, -210, 590, 590, 28, 190)
$graphics.DrawArc($goldPen, 710, -174, 515, 515, 28, 190)
$graphics.DrawArc($greenPen, 764, 274, 380, 310, 190, 150)
$goldPen.Dispose()
$greenPen.Dispose()

$gold = Convert-HexColor '#D5AE68'
$white = Convert-HexColor '#F7F1E7'
$muted = Convert-HexColor '#C2B8A8'
$green = Convert-HexColor '#4CC878'

$smallFont = [System.Drawing.Font]::new('Segoe UI', 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$titleFont = [System.Drawing.Font]::new('Segoe UI', 48, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$subFont = [System.Drawing.Font]::new('Segoe UI', 19, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$tagFont = [System.Drawing.Font]::new('Segoe UI', 17, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

$brandBrush = [System.Drawing.SolidBrush]::new($gold)
$titleBrush = [System.Drawing.SolidBrush]::new($white)
$mutedBrush = [System.Drawing.SolidBrush]::new($muted)
$greenBrush = [System.Drawing.SolidBrush]::new($green)

# Wordmark and primary message.
$graphics.DrawString('MAFITAPAY', $smallFont, $brandBrush, 68, 58)
$graphics.DrawString('Your money.', $titleFont, $titleBrush, 64, 150)
$graphics.DrawString('One place.', $titleFont, $titleBrush, 64, 208)
$graphics.DrawString('Wallet, transfers, bills and crypto in one app.', $subFont, $mutedBrush, 68, 296)

# Product categories are descriptive, not fabricated balance or transaction data.
$tags = @(
  @{ Text = 'Wallet'; X = 68; Width = 134; Color = '#C9A460' },
  @{ Text = 'Bills'; X = 216; Width = 112; Color = '#8F7855' },
  @{ Text = 'Crypto'; X = 342; Width = 134; Color = '#3E8A5C' }
)
foreach ($tag in $tags) {
  $tagColor = Convert-HexColor $tag.Color
  $tagFill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(34, $tagColor.R, $tagColor.G, $tagColor.B))
  $tagBorder = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(115, $tagColor.R, $tagColor.G, $tagColor.B), 1.5)
  Draw-RoundedRectangle $graphics $tag.X 360 $tag.Width 52 24 $tagFill $tagBorder 1.5
  $graphics.DrawString($tag.Text, $tagFont, $titleBrush, ($tag.X + 20), 375)
  $tagFill.Dispose()
  $tagBorder.Dispose()
}

# Abstract wallet motif on the right: recognizable as a finance app without claiming a real balance.
$cardFill = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.Rectangle]::new(608, 104, 342, 292),
  (Convert-HexColor '#282116'),
  (Convert-HexColor '#11100D'),
  28
)
$cardBorder = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(110, 202, 165, 96), 2)
Draw-RoundedRectangle $graphics 608 104 342 292 30 $cardFill $cardBorder 2
$cardFill.Dispose()
$cardBorder.Dispose()

$walletLabelFont = [System.Drawing.Font]::new('Segoe UI', 14, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$walletTitleFont = [System.Drawing.Font]::new('Segoe UI', 26, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$graphics.DrawString('MAFITAPAY WALLET', $walletLabelFont, $brandBrush, 644, 142)
$graphics.DrawString('Everyday finance,', $walletTitleFont, $titleBrush, 644, 192)
$graphics.DrawString('made simpler.', $walletTitleFont, $titleBrush, 644, 228)

$linePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(75, 255, 255, 255), 1)
$graphics.DrawLine($linePen, 644, 284, 914, 284)
$linePen.Dispose()

$rowYs = @(314, 350)
$rowLabels = @('Move money', 'Pay everyday bills')
for ($i = 0; $i -lt $rowYs.Count; $i++) {
  $graphics.FillEllipse($greenBrush, 646, ($rowYs[$i] + 4), 12, 12)
  $graphics.DrawString($rowLabels[$i], $subFont, $mutedBrush, 670, $rowYs[$i])
}

# Fine print label helps distinguish promotional art from a live account screen.
$footFont = [System.Drawing.Font]::new('Segoe UI', 11, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$footBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(145, 194, 184, 168))
$graphics.DrawString('SUPPORTED FEATURES VARY BY ACCOUNT AND LOCATION', $footFont, $footBrush, 68, 456)

$bitmap.Save($featurePngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Keep a simple, editable vector source alongside the upload-ready PNG.
$svg = @'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
 <defs><linearGradient id="bg" x2="1" y2="0"><stop stop-color="#0c0907"/><stop offset="1" stop-color="#21180f"/></linearGradient><linearGradient id="card" x2="0" y2="1"><stop stop-color="#282116"/><stop offset="1" stop-color="#11100d"/></linearGradient></defs>
 <rect width="1024" height="500" fill="url(#bg)"/>
 <g fill="none" stroke="#caa560" stroke-opacity=".16" stroke-width="2"><path d="M680 50a290 290 0 1 1 480 195"/><path d="M720 80a250 250 0 1 1 410 205"/></g>
 <g font-family="Segoe UI,Arial,sans-serif"><text x="68" y="76" fill="#d5ae68" font-size="15" font-weight="700" letter-spacing="2">MAFITAPAY</text><text x="64" y="202" fill="#f7f1e7" font-size="48" font-weight="700">Your money.</text><text x="64" y="260" fill="#f7f1e7" font-size="48" font-weight="700">One place.</text><text x="68" y="320" fill="#c2b8a8" font-size="19">Wallet, transfers, bills and crypto in one app.</text>
 <g font-size="17" font-weight="600"><rect x="68" y="360" width="134" height="52" rx="26" fill="#c9a460" fill-opacity=".13" stroke="#c9a460"/><text x="88" y="393" fill="#f7f1e7">Wallet</text><rect x="216" y="360" width="112" height="52" rx="26" fill="#8f7855" fill-opacity=".13" stroke="#8f7855"/><text x="236" y="393" fill="#f7f1e7">Bills</text><rect x="342" y="360" width="134" height="52" rx="26" fill="#3e8a5c" fill-opacity=".13" stroke="#3e8a5c"/><text x="362" y="393" fill="#f7f1e7">Crypto</text></g>
 <rect x="608" y="104" width="342" height="292" rx="30" fill="url(#card)" stroke="#caa560" stroke-opacity=".45" stroke-width="2"/><text x="644" y="160" fill="#d5ae68" font-size="14" font-weight="700" letter-spacing="1.5">MAFITAPAY WALLET</text><text x="644" y="218" fill="#f7f1e7" font-size="26" font-weight="700">Everyday finance,</text><text x="644" y="254" fill="#f7f1e7" font-size="26" font-weight="700">made simpler.</text><path d="M644 284h270" stroke="#ffffff" stroke-opacity=".3"/><circle cx="652" cy="324" r="6" fill="#4cc878"/><text x="670" y="330" fill="#c2b8a8" font-size="19">Move money</text><circle cx="652" cy="360" r="6" fill="#4cc878"/><text x="670" y="366" fill="#c2b8a8" font-size="19">Pay everyday bills</text><text x="68" y="468" fill="#c2b8a8" fill-opacity=".57" font-size="11" letter-spacing="1">SUPPORTED FEATURES VARY BY ACCOUNT AND LOCATION</text></g>
</svg>
'@
Set-Content -LiteralPath $featureSvgPath -Value $svg -Encoding utf8

$footBrush.Dispose()
$footFont.Dispose()
$walletLabelFont.Dispose()
$walletTitleFont.Dispose()
$tagFont.Dispose()
$smallFont.Dispose()
$titleFont.Dispose()
$subFont.Dispose()
$brandBrush.Dispose()
$titleBrush.Dispose()
$mutedBrush.Dispose()
$greenBrush.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Created $iconPath"
Write-Output "Created $featurePngPath"
Write-Output "Created $featureSvgPath"
