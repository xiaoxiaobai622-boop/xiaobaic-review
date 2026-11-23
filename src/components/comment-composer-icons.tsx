import type { SVGProps } from 'react'

// Paths copied from Frame.io's Vapor icon modules (IconEmoji,
// IconAnnotations, IconSentFill) and the attachment button's inline SVG.
export function AttachmentSparkleIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...props}>
      <path
        clipRule="evenodd"
        d="M11.8938 5.63538C13.7488 3.78039 16.7564 3.78039 18.6114 5.63538C19.8449 6.86891 20.2572 8.61173 19.8518 10.1839C19.828 10.2765 19.8012 10.3685 19.7717 10.4599C19.6442 10.854 19.2213 11.0701 18.8272 10.9426C18.4331 10.815 18.217 10.3922 18.3445 9.99809C18.3647 9.93567 18.383 9.87274 18.3993 9.80938C18.6776 8.72999 18.3936 7.53894 17.5507 6.69604C16.2815 5.42684 14.2237 5.42684 12.9545 6.69604L7.6512 11.9993C7.3583 12.2922 6.88343 12.2922 6.59054 11.9993C6.29764 11.7065 6.29764 11.2316 6.59054 10.9387L11.8938 5.63538ZM14.0152 9.52447C14.3081 9.81736 14.3081 10.2922 14.0152 10.5851L8.18153 16.4188C7.59574 17.0045 7.59574 17.9543 8.18153 18.5401C8.63822 18.9968 9.31767 19.0984 9.87349 18.8408C9.88454 18.8357 9.89555 18.8304 9.9065 18.825C10.2779 18.6416 10.7276 18.7939 10.9111 19.1653C11.0945 19.5367 10.9421 19.9865 10.5707 20.1699C10.5487 20.1808 10.5266 20.1914 10.5043 20.2017C9.39592 20.7155 8.03674 20.5166 7.12087 19.6007C5.94929 18.4292 5.94929 16.5297 7.12087 15.3581L12.9545 9.52447C13.2474 9.23158 13.7223 9.23158 14.0152 9.52447Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M17.2606 13.1834C17.3265 12.9389 17.6735 12.9389 17.7394 13.1834L18.3074 15.2933C18.4911 15.9757 19.0242 16.5089 19.7067 16.6926L21.8166 17.2606C22.0611 17.3265 22.0611 17.6735 21.8166 17.7394L19.7067 18.3074C19.0242 18.4911 18.4911 19.0242 18.3074 19.7067L17.7394 21.8166C17.6735 22.0611 17.3265 22.0611 17.2606 21.8166L16.6926 19.7067C16.5089 19.0242 15.9758 18.4911 15.2933 18.3074L13.1834 17.7394C12.9389 17.6735 12.9389 17.3265 13.1834 17.2606L15.2933 16.6926C15.9758 16.5089 16.5089 15.9758 16.6926 15.2933L17.2606 13.1834Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  )
}

export function AnnotationBackIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13.738 6.183a.75.75 0 0 1 .081 1.058L9.74 12l4.084 4.762a.75.75 0 1 1-1.138.976l-4.504-5.25a.75.75 0 0 1 0-.976l4.5-5.248a.75.75 0 0 1 1.057-.08Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function AnnotationArrowIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...props}>
      <path d="M17.25 6a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0V8.561l-9.22 9.22a.75.75 0 1 1-1.06-1.061l9.22-9.22H9.75a.75.75 0 0 1 0-1.5h7.5Z" fill="currentColor" />
    </svg>
  )
}

export function AnnotationRectangleIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 6.75A2.75 2.75 0 0 1 6.75 4h10.5A2.75 2.75 0 0 1 20 6.75v10.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25V6.75ZM6.75 5.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25V6.75c0-.69-.56-1.25-1.25-1.25H6.75Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function AnnotationPenIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...props}>
      <path d="M11.058 3.662c.317-.884 1.567-.884 1.883 0l1.913 5.344a1.75 1.75 0 0 1 1.556 1.346l1.57 6.728a.75.75 0 1 1-1.46.34l-1.57-6.727a.25.25 0 0 0-.244-.193H9.293a.25.25 0 0 0-.243.193L7.48 17.42a.75.75 0 0 1-1.46-.34l1.57-6.727a1.75 1.75 0 0 1 1.556-1.347l1.912-5.344Z" fill="currentColor" />
    </svg>
  )
}

export function AnnotationUndoIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.74 7.2a.75.75 0 0 1 1.02 1.1l-2.1 1.948h6.59a3.75 3.75 0 0 1 3.75 3.75v2.252a.75.75 0 0 1-1.5 0v-2.252a2.25 2.25 0 0 0-2.25-2.25H7.659l2.102 1.953a.75.75 0 1 1-1.021 1.098l-3.5-3.251a.75.75 0 0 1 0-1.1L8.74 7.2Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function AnnotationRedoIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15.26 7.2a.75.75 0 0 1-1.02 1.1l2.1 1.948H9.75A3.75 3.75 0 0 0 6 13.998v2.252a.75.75 0 0 0 1.5 0v-2.252a2.25 2.25 0 0 1 2.25-2.25h6.591l-2.102 1.953a.75.75 0 0 0 1.021 1.098l3.5-3.251a.75.75 0 0 0 0-1.1L15.26 7.2Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function CommentEmojiIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} {...props}>
      <path d="M9 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm-5.531 2.557a.75.75 0 0 0-1.449.39 4.125 4.125 0 0 0 7.966.003.75.75 0 0 0-1.449-.392 2.625 2.625 0 0 1-5.068 0Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0Zm9-7.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z"
      />
    </svg>
  )
}

export function DrawAnnotationIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} {...props}>
      <path d="M10.77 10.377a1 1 0 0 0-.132.437l-.105 1.665a.5.5 0 0 0 .793.436l1.32-.96a1 1 0 0 0 .278-.309l3.912-6.775a1.25 1.25 0 1 0-2.165-1.25l-3.901 6.756Z" />
      <path d="M11.016 6.75a.758.758 0 0 1-.758.748c-2.938 0-4.882 1.71-5.517 3.95-.708 2.499.245 4.459 1.979 5.851 1.767 1.42 4.31 2.203 6.547 2.203.415 0 .749.335.745.748a.758.758 0 0 1-.758.748c-2.536 0-5.421-.873-7.485-2.531-2.098-1.686-3.38-4.225-2.475-7.414.818-2.883 3.354-5.051 6.977-5.051.415 0 .749.335.745.748Z" />
      <path d="M17.147 8.315a.767.767 0 0 1 1.058-.168c1.666 1.188 2.508 2.542 2.733 3.876a4.5 4.5 0 0 1-.805 3.392c-.919 1.434-2.714 2.074-4.479 2.185-1.799.113-3.78-.302-5.292-1.216a.733.733 0 0 1-.242-1.022.768.768 0 0 1 1.042-.246c1.216.734 2.881 1.096 4.409 1 1.553-.097 2.755-.647 3.292-1.5l.015-.022.015-.021a3.025 3.025 0 0 0 .553-2.294c-.148-.876-.72-1.915-2.137-2.926a.733.733 0 0 1-.162-1.038Z" />
    </svg>
  )
}

export function SendPlaneIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.616 9.538a.56.56 0 0 0-.05 1.045l5.206 2.3a.56.56 0 0 0 .554-.059l4.59-3.308c.05-.036.082-.036.1-.034a.165.165 0 0 1 .093.05.166.166 0 0 1 .05.093c.002.018.002.05-.035.1l-3.308 4.59a.56.56 0 0 0-.058.553l2.3 5.206a.56.56 0 0 0 1.044-.049l4.889-14.666a.56.56 0 0 0-.71-.71L3.617 9.54Z"
        fill="currentColor"
      />
    </svg>
  )
}
