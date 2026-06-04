'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function NavBar() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header className="fixed z-50 top-4 px-4 w-full transition-all duration-300 flex justify-center">
      <div
        className={`w-full max-w-4xl h-14 transition-all duration-300 flex items-center px-6 rounded-full ${
          isScrolled
            ? 'bg-white/80 backdrop-blur-md border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.08)]'
            : 'bg-transparent border border-transparent'
        }`}
      >
        <Link
          href="/"
          onClick={(e) => {
            if (window.location.pathname === '/') {
              e.preventDefault()
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }
          }}
          className="font-display text-xl font-bold text-[#242843] tracking-tight"
        >
          ScubaSearch
        </Link>
      </div>
    </header>
  )
}
