# Real-Time Impact Analyzer

A powerful VS Code extension that provides real-time code impact analysis with intelligent test discovery and execution.

## 🚀 Features

### Core Functionality
- **Real-time Impact Analysis** - Automatically analyzes code changes on file save
- **Intelligent Test Discovery** - Finds affected tests using multiple strategies
- **Multi-language Support** - JavaScript, TypeScript, Python, Java, C#, Go, Rust
- **Git Integration** - Tracks actual changes, not just file saves
- **Smart Caching** - Avoids redundant analysis with intelligent caching

### Advanced Features
- **Downstream Component Detection** - Identifies components that might break
- **Risk Assessment** - Categorizes changes as low/medium/high risk
- **Test Execution** - Run affected tests directly from the IDE
- **Pre-commit Hooks** - Block commits if tests fail
- **Performance Metrics** - Estimated test run time and coverage impact
- **Confidence Scoring** - How certain we are about impact predictions

## 📦 Installation

### Development Installation
1. Clone or download this extension
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Press `F5` in VS Code to run the extension in development mode

### Production Installation
1. Package the extension: `vsce package`
2. Install the generated `.vsix` file in VS Code

## 🎯 Usage

### Commands
- `Ctrl+Shift+I` - Analyze current file impact
- `Ctrl+Shift+T` - Run affected tests
- `AutoTest: Analyze Workspace` - Analyze entire workspace
- `AutoTest: Run Pre-Commit Tests` - Run tests before committing
- `AutoTest: Toggle Auto-Analysis` - Enable/disable auto-analysis

### Auto-Analysis
The extension automatically analyzes files when you save them (if enabled). You'll see:
- Real-time notifications about affected tests
- Risk level indicators for high-impact changes
- Analysis results in the Impact Analysis panel

### Impact Analysis Panel
Located in the Explorer sidebar, shows:
- **Workspace Analysis** - Analyze all files in workspace
- **Recent Analysis** - View recent analysis results
- **File Details** - Expand to see:
  - Changed functions and classes
  - Affected tests
  - Downstream components
  - Risk metrics and confidence scores

## ⚙️ Configuration

### Settings
```json
{
  "impactAnalyzer.autoAnalysis": true,
  "impactAnalyzer.analysisDelay": 500,
  "impactAnalyzer.showInlineAnnotations": true,
  "impactAnalyzer.testFrameworks": ["jest", "mocha", "pytest", "junit"],
  "impactAnalyzer.testPatterns": ["**/*.test.*", "**/*.spec.*"],
  "impactAnalyzer.sourcePatterns": ["**/*.js", "**/*.ts", "**/*.py"],
  "impactAnalyzer.maxAnalysisTime": 10000,
  "impactAnalyzer.cacheEnabled": true,
  "impactAnalyzer.gitIntegration": true,
  "impactAnalyzer.preCommitHooks": false
}
```

### Test Framework Support
- **JavaScript/TypeScript**: Jest, Mocha, Vitest, Cypress, Playwright
- **Python**: Pytest
- **Java**: JUnit
- **C#**: NUnit
- **Go**: Built-in testing
- **Rust**: Built-in testing

## 🔧 Architecture

### Core Components
- **ImpactAnalyzer** - Main analysis engine
- **CodeAnalyzer** - Language-specific code parsing
- **TestFinder** - Multi-strategy test discovery
- **DependencyAnalyzer** - Downstream impact detection
- **GitAnalyzer** - Git integration for change tracking
- **FileWatcher** - Real-time file monitoring
- **TestRunner** - Framework-aware test execution

### Analysis Strategies
1. **File Name Matching** - Tests with similar names to source files
2. **Import Analysis** - Tests that import the source file
3. **Function/Class Matching** - Tests that reference specific functions or classes
4. **Content Analysis** - Semantic analysis of test file content
5. **Git Integration** - Track actual changes vs. file saves

## 🎨 UI Components

### Impact Analysis View
- Hierarchical tree view of analysis results
- Color-coded risk indicators
- Quick actions for test execution
- Detailed metrics and confidence scores

### Inline Annotations
- Show impact directly in the editor
- Highlight affected functions and classes
- Display risk levels and confidence

### Output Channels
- Dedicated test runner output
- Analysis logs and debugging information
- Error reporting and troubleshooting

## 🚀 Advanced Features

### Smart Test Discovery
- **Pattern Matching** - Recognizes test file naming conventions
- **Import Analysis** - Finds tests that import source files
- **Content Analysis** - Identifies tests that reference specific functions
- **Directory Scanning** - Searches common test directories

### Risk Assessment
- **Low Risk** - Simple changes with minimal impact
- **Medium Risk** - Moderate changes affecting multiple components
- **High Risk** - Complex changes with widespread impact

### Performance Optimization
- **Background Processing** - Non-blocking analysis
- **Incremental Analysis** - Only analyze changed parts
- **Smart Caching** - Avoid redundant computations
- **Timeout Protection** - Prevent analysis from hanging

## 🔍 Troubleshooting

### Common Issues
1. **Extension not activating** - Check VS Code version compatibility
2. **No analysis results** - Verify file patterns and test discovery
3. **Slow performance** - Adjust analysis timeout and caching settings
4. **Git integration issues** - Ensure you're in a git repository

### Debug Mode
1. Open Developer Tools (`Help > Toggle Developer Tools`)
2. Check Console for error messages
3. Look for "Impact Analyzer" prefixed logs

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues and feature requests, please use the GitHub issue tracker.

---

**Real-Time Impact Analyzer** - Making code changes safer and more predictable! 🎯
