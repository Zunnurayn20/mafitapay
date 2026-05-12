'use client'

import { useState } from 'react'

function isImageSource(value?: string) {
  if (!value) return false
  return value.startsWith('/') || value.startsWith('http://') || value.startsWith('https://')
}

export function AssetLogo({
  src,
  alt,
  fallback,
  className = '',
  imgClassName = '',
  textClassName = '',
}: {
  src?: string
  alt: string
  fallback: string
  className?: string
  imgClassName?: string
  textClassName?: string
}) {
  const [failed, setFailed] = useState(false)
  const useImage = isImageSource(src) && !failed

  return (
    <div className={className}>
      {useImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className={imgClassName}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={textClassName}>{fallback}</span>
      )}
    </div>
  )
}
