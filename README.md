# ✨ Cosmic CIDR Subnet Calculator

**This project has been created entirely by Claude 3.7 Sonnet "Extended thinking" using Claude Desktop and File Server MCP. The AI assistant implemented all features, styling, and functionality without human code contribution.**

A visual web-based tool for planning and allocating subnet spaces within a CIDR block, designed for network engineers and cloud infrastructure planning.

## Features

- Input validation for CIDR blocks (max /16)
- Visual representation of IP space with proper CIDR labels
- Drag and drop interface for subnet allocation
- Click-to-place functionality for subnet allocation
- Movable subnet blocks that snap to valid network boundaries
- Real-time validation to prevent overlapping subnets
- Color-coded subnet types (public, private, database)
- Summary table with detailed subnet information
- Type toggling directly in the summary table
- Double-click to remove subnets (from visualization or table)
- Percentage indicator for IP space utilization
- Highlighting of valid drop positions when placing subnet blocks
- Light and dark mode support with cosmic-themed background
- Consistent UI with context-sensitive instructions

## Getting Started

### Prerequisites

You need to have Node.js and npm installed on your machine.

### Installation

1. Clone the repository
2. Install dependencies:
```
npm install
```
3. Start the development server:
```
npm start
```

## Usage

1. Enter a valid CIDR block in the input box (e.g., "10.0.0.0/16")
2. Select subnets in two ways:
   - Drag subnet blocks from the right panel onto the IP space bar
   - Click a subnet size to select it, then click on the IP space bar to place it
3. The tool will only allow placing blocks at valid network boundaries (highlighted in green)
4. As you place subnets, the summary table will update with complete network details
5. To remove a subnet, double-click it (either in the visualization or the summary table)
6. To change a subnet type, click the colored type label in the summary table
7. To move an existing subnet, drag it to a new position on the IP space bar
8. The progress bar shows what percentage of your address space is allocated
9. Toggle between light, dark, and auto theme modes with the theme switcher

## Directory Structure
```
cosmic-subnet-calculator/
├── public/
│   ├── index.html
│   └── manifest.json
├── src/
│   ├── App.js
│   ├── App.css
│   ├── index.js
│   ├── index.css
│   ├── reportWebVitals.js
│   └── components/
│       └── SubnetCalculator.js  # Main implementation
└── package.json
```

## Implementation Details
- React application with Tailwind CSS for styling
- React's drag and drop API for subnet manipulation
- CIDR calculations performed with bitwise operations
- Bar width adapts to container size for responsive layout
- Flexbox centering for proper alignment of content
- Fixed-width type labels to prevent table shifting
- Semantic colors to distinguish subnet types (public, private, database)

## License

This project is licensed under the MIT License.
