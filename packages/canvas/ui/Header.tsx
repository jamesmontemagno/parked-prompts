import type { ReactNode } from 'react'

export interface HeaderProps {
  title: string
  /** A small mark shown before the title, such as an icon. */
  icon?: ReactNode
  /** Shown after the title, such as a status pill. */
  badge?: ReactNode
  /** Controls at the right end, such as icon buttons. */
  children?: ReactNode
}

/** The sticky bar at the top of every canvas. Put the page under it in `<main className="page">`. */
export function Header({ title, icon, badge, children }: HeaderProps) {
  return (
    <header className="top">
      <div className="top-row">
        <div className="title-wrap">
          {icon && <span className="title-icon">{icon}</span>}
          <h1 className="title">{title}</h1>
          {badge}
        </div>
        {children && <div className="controls">{children}</div>}
      </div>
    </header>
  )
}
