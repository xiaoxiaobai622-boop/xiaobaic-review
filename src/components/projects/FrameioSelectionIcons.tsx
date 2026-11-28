import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function IconBase({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function SelectionIconX(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="M11.78 5.28a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72Z"
        fill="currentColor"
      />
    </IconBase>
  )
}

export function SelectionIconMore(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="M13 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
        fill="currentColor"
      />
    </IconBase>
  )
}

export function SelectionIconDownload(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 2a.75.75 0 0 1 .75.75v5.543l.941-1.045a.75.75 0 1 1 1.115 1.004l-2.249 2.495a.75.75 0 0 1-1.114 0l-2.25-2.495a.75.75 0 0 1 1.114-1.004l.943 1.046V2.75A.75.75 0 0 1 8 2Zm-5.25 8a.75.75 0 0 1 .75.75v1.5c0 .138.111.25.25.25h8.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-1.5a.75.75 0 0 1 .75-.75Z"
        fill="currentColor"
      />
    </IconBase>
  )
}

export function SelectionIconFolder(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2 3.75C2 2.784 2.784 2 3.75 2h3.014c.272 0 .54.063.783.185l1.577.789A.25.25 0 0 0 9.236 3h4.014c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 14h-9.5A1.75 1.75 0 0 1 2 12.25v-8.5Zm1.5 0a.25.25 0 0 1 .25-.25h3.014a.25.25 0 0 1 .112.026l1.577.79c.243.12.511.184.783.184h4.014a.25.25 0 0 1 .25.25V6h-10V3.75Zm0 3.75h10v4.75a.25.25 0 0 1-.25.25h-9.5a.25.25 0 0 1-.25-.25V7.5Z"
        fill="currentColor"
      />
    </IconBase>
  )
}

export function SelectionIconTrash(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.996 4c0-1.693 1.35-3 3-3s3 1.307 3 3v.004h2.258a.75.75 0 0 1 0 1.5h-.53l-.424 7.84A1.75 1.75 0 0 1 10.553 15H5.45a1.75 1.75 0 0 1-1.748-1.655l-.427-7.84h-.522a.75.75 0 1 1 0-1.5h2.242V4Zm-.217 1.504.422 7.76a.25.25 0 0 0 .25.236h5.102a.25.25 0 0 0 .25-.236l.419-7.76H4.779ZM9.496 4v.004h-3V4c0-.852.665-1.5 1.5-1.5s1.5.648 1.5 1.5ZM6.75 7a.75.75 0 0 1 .75.75v3.5a.75.75 0 1 1-1.5 0v-3.5A.75.75 0 0 1 6.75 7Zm3.25.75a.75.75 0 1 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5Z"
        fill="currentColor"
      />
    </IconBase>
  )
}
