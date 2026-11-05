import type { ReactNode } from 'react'

export interface HeaderProps {
  title: string
  /** Shown before the title, such as a status pill. */
  badge?: ReactNode
  /** Controls at the right end, such as icon buttons. */
  children?: ReactNode
}

/** The sticky bar at the top of every canvas. Put the page under it in `<main className="page">`. */
export function Header({ title, badge, children }: HeaderProps) {
  return (
    <header className="top">
      <div className="top-row">
        <div className="title-wrap">
          {badge}
          <h1 className="title">{title}</h1>
        </div>
        {children && <div className="controls">{children}</div>}
      </div>
    </header>
  )
}
