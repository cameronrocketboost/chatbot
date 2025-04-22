import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 relative overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-sladen-navy text-sladen-white hover:bg-sladen-navy/90 active:translate-y-0.5 shadow-sm transform hover:rotate-[-0.15deg] transition-all duration-300",
        destructive:
          "bg-sladen-red text-sladen-white hover:bg-sladen-red/90 active:translate-y-0.5 shadow-sm transform hover:rotate-[0.15deg] transition-all duration-300",
        outline:
          "border-2 border-sladen-navy/20 bg-background hover:bg-sladen-navy/5 hover:border-sladen-navy/30 hover:text-sladen-navy active:translate-y-0.5 transition-all duration-300",
        secondary:
          "bg-sladen-teal text-sladen-white hover:bg-sladen-teal/90 active:translate-y-0.5 shadow-sm transform hover:rotate-[0.15deg] transition-all duration-300",
        ghost: "hover:bg-sladen-navy/5 hover:text-sladen-navy transition-colors",
        link: "text-sladen-teal underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
