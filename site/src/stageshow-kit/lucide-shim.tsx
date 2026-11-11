// A stand-in for 'lucide-react', which this site doesn't install: vite.config.mjs
// aliases the package name to this file. It exports only the glyphs the kit's
// parts reach for (check, x, chevron-down), drawn as lucide draws them. The
// two scenes use none of those parts today, so the build leaves this file
// out; if a scene starts to, add Lucide's notice (below) to
// /third-party-licenses.txt, as the pages will then send its path data.
//
// Path data from Lucide (lucide.dev), under the ISC License:
//
//   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
//   part of Feather (MIT). All other copyright (c) for Lucide are held by
//   Lucide Contributors 2022.
//
//   Permission to use, copy, modify, and/or distribute this software for any
//   purpose with or without fee is hereby granted, provided that the above
//   copyright notice and this permission notice appear in all copies.
//
//   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
//   WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
//   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
//   ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
//   WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
//   ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
//   OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

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
