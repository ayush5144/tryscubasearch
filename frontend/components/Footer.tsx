export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-[#e2e8f0] bg-white">
      <div className="mx-auto max-w-[900px] px-6 py-6 text-center">
        <span className="font-display text-[1.1rem] font-bold text-[#242843]">ScubaSearch</span>
        <p className="mt-1 text-[0.8rem] text-[#64748b]">by Ayush Patil</p>
        <a
          href="mailto:ayushpatil9977@gmail.com"
          className="mt-1 block text-[0.75rem] text-[#94a3b8] hover:text-[#4338ca] transition-colors"
        >
          ayushpatil9977@gmail.com
        </a>
        <p className="mt-3 text-[0.75rem] text-[#94a3b8]">&copy; {year} ScubaSearch</p>
      </div>
    </footer>
  )
}
