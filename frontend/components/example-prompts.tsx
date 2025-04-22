import { Button } from "@/components/ui/button"
import { PlusCircle } from "lucide-react"

interface ExamplePromptsProps {
  onSelect: (prompt: string) => void
}

// Examples showing off different retrieval capabilities
const ENHANCED_RETRIEVAL_EXAMPLES = [
  { 
    text: "Can you summarize report.pdf?", 
    tooltip: "Shows document-specific retrieval",
    icon: "📄"
  },
  { 
    text: "Find information about quarterly results in all PDF documents", 
    tooltip: "Filters by document type (PDF)",
    icon: "🔍"
  },
  { 
    text: "Show me the full PowerPoint presentation about marketing", 
    tooltip: "Uses PowerPoint retrieval mode",
    icon: "📊"
  },
  { 
    text: "What were the key findings in the most recent documents?", 
    tooltip: "Uses recency-based sorting",
    icon: "🕒"
  }
]

export function ExamplePrompts({ onSelect }: ExamplePromptsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
      {ENHANCED_RETRIEVAL_EXAMPLES.map((example, index) => {
        // Different rotations for each button to create a hand-drawn look
        const rotation = (index % 4 - 1.5) * 0.3; // Values between -0.45 and 0.45 degrees
        
        return (
          <Button
            key={index}
            variant="outline"
            className="relative group h-auto py-3 px-4 text-sm text-left font-medium border-2 border-sladen-navy/15 bg-white hover:bg-sladen-peach/10 text-sladen-navy hover:text-sladen-navy hover:border-sladen-navy/30 transition-all duration-200 justify-start overflow-visible"
            style={{ transform: `rotate(${rotation}deg)` }}
            onClick={() => onSelect(example.text)}
          >
            <div className="absolute -top-9 left-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-xs text-white bg-sladen-navy p-1.5 rounded-md shadow-md z-10 pointer-events-none">
              {example.tooltip}
            </div>
            <span className="mr-2 text-base">{example.icon}</span>
            <span className="line-clamp-2">{example.text}</span>
          </Button>
        );
      })}
    </div>
  )
}

