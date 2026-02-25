 OPC-workflow

One-person company workflow

## Project Introduction

OPC-workflow is a workflow management system designed for one-person companies, helping individual entrepreneurs efficiently manage daily work, projects, and finances.

## Features

- **Frontend Interface**: Provides an intuitive user interface with dashboard, financial reports, market analysis, and other features
- **Backend Service**: Node.js-based backend service that handles data storage and business logic
- **Data Management**: Supports management and export of employee information, model usage, financial reports, etc.
- **Automated Workflow**: Integrates with Coze AI assistant to实现 intelligent workflow automation

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript
- **Backend**: Node.js, Express
- **Data Storage**: JSON files (local development environment)
- **AI Integration**: Coze AI platform

## Quick Start

### Environment Requirements

- Node.js 14.0 or higher
- npm 6.0 or higher

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/42433422/OPC-workflow.git
   cd OPC-workflow
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd backend
   npm install
   ```

3. **Start the service**
   ```bash
   # Start backend service
   cd backend
   node server.js
   
   # Frontend access
   # Open browser and visit http://localhost:3000
   ```

## Project Structure

```
OPC-workflow/
├── backend/           # Backend service
│   ├── data/          # Data files
│   ├── package.json   # Backend dependencies
│   └── server.js      # Backend entry point
├── frontend/          # Frontend interface
│   ├── index.html     # Main page
│   ├── app.js         # Frontend logic
│   └── style.css      # Style files
├── scripts/           # Script files
├── package.json       # Project dependencies
├── LICENSE            # Apache 2.0 License
└── README.md          # Project documentation
```

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

## Contribution

Welcome to submit Issues and Pull Requests to improve the project.

## Contact

If you have any questions or suggestions, please contact us through GitHub Issues.

## Version Information

- **Current Version**: v1.0.0
- **Release Date**: 2026-02-26
