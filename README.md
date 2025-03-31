# Cosmic CIDR Subnet Calculator

A visual tool for planning and allocating subnet spaces within a CIDR block.

## Features

- Input validation for CIDR blocks (max /16)
- Visual representation of the IP space
- Drag and drop subnet allocation
- Automatic validation to prevent overlapping subnets
- Color-coded subnet types (public, private, database)
- Real-time summary table of allocated subnets
- Progress bar showing IP space utilization

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
2. Drag subnet blocks from the right panel onto the horizontal bar
3. The tool will only allow placing blocks at valid network boundaries
4. As you place subnets, the summary table will update with network details
5. To remove a subnet, simply click on it
6. The progress bar shows how much of your address space is allocated

## License

This project is licensed under the MIT License.
