// A stand-in for 'lucide-react', which this site doesn't install: vite.config.mjs
// aliases the package name to this file. It exports only the glyphs the kit's
// parts reach for in these scenes, drawn as lucide draws them.
//
// Path data from Lucide (lucide.dev), ISC licence; the notice is in
// /third-party-licenses.txt.

import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'stroke'> & {
  size?: number | string
  strokeWidth?: number | string
  absoluteStrokeWidth?: boolean
  color?: string
}

function make(name: string, paths: string[]) {
  function Glyph({ size = 24, strokeWidth = 2, absoluteStrokeWidth, color = 'currentColor', className, ...rest }: IconProps) {
    const width = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`lucide lucide-${name}${className ? ` ${className}` : ''}`}
        {...rest}
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    )
  }
  Glyph.displayName = name
  return Glyph
}

export const Check = make('check', ['M20 6 9 17l-5-5'])
export const X = make('x', ['M18 6 6 18', 'm6 6 12 12'])
export const ChevronDown = make('chevron-down', ['m6 9 6 6 6-6'])
