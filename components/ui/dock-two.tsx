import * as React from "react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { LucideIcon, Search, X } from "lucide-react"

function buildDisplacementMap(
  w: number,
  h: number,
  radius: number,
  border = 0.07,
  lightness = 50,
  alpha = 0.93,
  blur = 11,
  blend = "difference"
) {
  const b = Math.min(w, h) * (border * 0.5)
  const svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="r" x1="100%" y1="0%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/>
      </linearGradient>
      <linearGradient id="b" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="black"/>
    <rect width="${w}" height="${h}" rx="${radius}" fill="url(#r)"/>
    <rect width="${w}" height="${h}" rx="${radius}" fill="url(#b)" style="mix-blend-mode:${blend}"/>
    <rect x="${b}" y="${b}" width="${w - b * 2}" height="${h - b * 2}" rx="${radius}"
      fill="hsl(0 0% ${lightness}% / ${alpha})" style="filter:blur(${blur}px)"/>
  </svg>`
  return "data:image/svg+xml," + encodeURIComponent(svg)
}

function useGlassDisplacement(enabled = true) {
  const filterId = useId().replace(/:/g, "_")
  const containerRef = useRef<HTMLDivElement>(null)
  const [mapHref, setMapHref] = useState("")
  const [dims, setDims] = useState({ w: 0, h: 0 })

  const updateMap = useCallback(
    (w: number, h: number) => {
      if (w > 0 && h > 0 && enabled) {
        setMapHref(buildDisplacementMap(w, h, 16, 0.07, 50, 0.93, 11, "difference"))
        setDims({ w, h })
      }
    },
    [enabled]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el || !enabled) return

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      updateMap(Math.round(width), Math.round(height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled, updateMap])

  const svgFilter = enabled ? (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      aria-hidden
    >
      <defs>
        <filter
          id={filterId}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={dims.w || "100%"}
          height={dims.h || "100%"}
        >
          <feImage
            href={mapHref}
            x="0"
            y="0"
            width={dims.w || "100%"}
            height={dims.h || "100%"}
            result="map"
          />
          {/* Red channel */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale={-180}
            xChannelSelector="R"
            yChannelSelector="G"
            result="dispRed"
          />
          <feColorMatrix
            in="dispRed"
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="red"
          />
          {/* Green channel */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale={-170}
            xChannelSelector="R"
            yChannelSelector="G"
            result="dispGreen"
          />
          <feColorMatrix
            in="dispGreen"
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="green"
          />
          {/* Blue channel */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale={-160}
            xChannelSelector="R"
            yChannelSelector="G"
            result="dispBlue"
          />
          <feColorMatrix
            in="dispBlue"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="blue"
          />
          {/* Recombine */}
          <feBlend in="red" in2="green" mode="screen" result="rg" />
          <feBlend in="rg" in2="blue" mode="screen" result="output" />
          <feGaussianBlur in="output" stdDeviation={0.7} />
        </filter>
      </defs>
    </svg>
  ) : null

  const backdropStyle: React.CSSProperties = enabled
    ? { backdropFilter: `url(#${filterId}) brightness(1.1) saturate(1.5)` }
    : {}

  const setContainerNode = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
  }, [])

  return { setContainerNode, svgFilter, backdropStyle, filterId }
}

function assignForwardedRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

interface DockItem {
  icon: LucideIcon
  label: string
  onClick?: () => void
  isSearch?: boolean
}

interface DockProps {
  className?: string
  items: DockItem[]
  searchValue?: string
  onSearchChange?: (query: string) => void
  onSearchClear?: () => void
  searchPlaceholder?: string
  searchLoading?: boolean
  glassDisplacement?: boolean
}

interface DockIconButtonProps {
  icon: LucideIcon
  label: string
  onClick?: () => void
  className?: string
}

const floatingAnimation = {
  initial: { y: 0 },
  animate: {
    y: [-2, 2, -2],
    transition: {
      duration: 4,
      repeat: Infinity,
      ease: "easeInOut"
    }
  }
}

const DockIconButton = React.forwardRef<HTMLButtonElement, DockIconButtonProps>(
  ({ icon: Icon, label, onClick, className }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: 1.1, y: -2 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className={cn(
          "relative group p-3 rounded-lg cursor-pointer",
          "hover:bg-secondary transition-colors",
          className
        )}
      >
        <Icon className="w-5 h-5 text-foreground" />
        <span className={cn(
          "absolute -top-8 left-1/2 -translate-x-1/2",
          "px-2 py-1 rounded text-xs",
          "bg-popover text-popover-foreground",
          "opacity-0 group-hover:opacity-100",
          "transition-opacity whitespace-nowrap pointer-events-none"
        )}>
          {label}
        </span>
      </motion.button>
    )
  }
)
DockIconButton.displayName = "DockIconButton"

const Dock = React.forwardRef<HTMLDivElement, DockProps>(
  ({ items, className, searchValue = "", onSearchChange, onSearchClear, searchPlaceholder = "Search...", searchLoading = false, glassDisplacement = false }, ref) => {
    const [searchOpen, setSearchOpen] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const isSearchActive = searchOpen || searchValue.length > 0
    const { setContainerNode, svgFilter, backdropStyle } = useGlassDisplacement(glassDisplacement)

    const handleSearchOpen = () => {
      setSearchOpen(true)
      setTimeout(() => inputRef.current?.focus(), 80)
    }

    const handleSearchClose = () => {
      setSearchOpen(false)
      onSearchClear?.()
    }

    // Merge refs so both the forwarded ref and the glass measurement ref work
    const mergedRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        setContainerNode(node)
        assignForwardedRef(ref, node)
      },
      [ref, setContainerNode]
    )

    return (
      <>
        {svgFilter}
        <motion.div
          ref={mergedRef}
          initial="initial"
          animate="animate"
          variants={floatingAnimation}
          layout
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className={cn(
            "flex items-center gap-1 p-2 rounded-2xl",
            !glassDisplacement && "backdrop-blur-lg",
            "border shadow-lg",
            "bg-background/90 border-border",
            "hover:shadow-xl transition-shadow duration-300",
            glassDisplacement && [
              "shadow-[0_0_2px_1px_hsl(0_0%_0%/0.15)_inset,0_0_10px_4px_hsl(0_0%_0%/0.1)_inset,0_4px_16px_rgba(17,17,26,0.05),0_8px_24px_rgba(17,17,26,0.05),0_16px_56px_rgba(17,17,26,0.05)]",
              "bg-background/5",
            ],
            className
          )}
          style={glassDisplacement ? backdropStyle : undefined}
        >
        <AnimatePresence mode="popLayout">
          {isSearchActive ? (
            <motion.div
              key="search"
              className="flex h-10 items-center gap-3 flex-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ minWidth: 320 }}
            >
              <Search
                className="h-4 w-4 shrink-0 ml-1 text-muted-foreground"
              />
              <input
                ref={inputRef}
                type="text"
                value={searchValue}
                onChange={(e) => onSearchChange?.(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent text-sm font-mono uppercase tracking-wider focus:outline-none min-w-0 text-foreground placeholder:text-muted-foreground"
                aria-label="Search gallery"
                onKeyDown={(e) => {
                  if (e.key === "Escape") handleSearchClose()
                }}
              />
              {searchLoading ? (
                <span className="text-xs font-mono uppercase tracking-wider shrink-0 mr-1 text-muted-foreground">
                  Searching
                </span>
              ) : (
                <motion.button
                  type="button"
                  onClick={handleSearchClose}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full cursor-pointer bg-secondary text-secondary-foreground"
                  aria-label="Close search"
                >
                  <X className="h-3.5 w-3.5" />
                </motion.button>
              )}
            </motion.div>
          ) : (
            items.map((item, index) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.15, delay: index * 0.03 }}
              >
                <DockIconButton
                  icon={item.icon}
                  label={item.label}
                  onClick={item.isSearch ? handleSearchOpen : item.onClick}
                />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </motion.div>
      </>
    )
  }
)
Dock.displayName = "Dock"

export { Dock }
