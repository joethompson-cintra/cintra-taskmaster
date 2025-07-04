/**
 * Unit tests for ADF to Markdown conversion
 * Tests how the system converts Jira's ADF format back to markdown
 */

import { JiraTicket } from '../utils/jira/jira-ticket';

describe('ADF to Markdown Conversion', () => {
    describe('Simple ADF structures', () => {
        test('should convert basic paragraph with bold text', () => {
            const mockADF = {
                version: 1,
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'This is '
                            },
                            {
                                type: 'text',
                                text: 'bold text',
                                marks: [
                                    {
                                        type: 'strong'
                                    }
                                ]
                            },
                            {
                                type: 'text',
                                text: ' in a paragraph.'
                            }
                        ]
                    }
                ]
            };

            const markdown = JiraTicket.extractTextFromNodes(mockADF.content);
            
            console.log('=== Basic Paragraph Test ===');
            console.log('Input ADF:', JSON.stringify(mockADF, null, 2));
            console.log('Output Markdown:', markdown);
            console.log('Expected: "This is **bold text** in a paragraph."');
            
            expect(markdown).toBe('This is **bold text** in a paragraph.');
        });

        test('should convert paragraph with italic and code formatting', () => {
            const mockADF = {
                version: 1,
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Use '
                            },
                            {
                                type: 'text',
                                text: 'npm install',
                                marks: [
                                    {
                                        type: 'code'
                                    }
                                ]
                            },
                            {
                                type: 'text',
                                text: ' to install '
                            },
                            {
                                type: 'text',
                                text: 'dependencies',
                                marks: [
                                    {
                                        type: 'em'
                                    }
                                ]
                            },
                            {
                                type: 'text',
                                text: '.'
                            }
                        ]
                    }
                ]
            };

            const markdown = JiraTicket.extractTextFromNodes(mockADF.content);
            
            console.log('=== Italic and Code Test ===');
            console.log('Input ADF:', JSON.stringify(mockADF, null, 2));
            console.log('Output Markdown:', markdown);
            console.log('Expected: "Use `npm install` to install *dependencies*."');
            
            expect(markdown).toBe('Use `npm install` to install *dependencies*.');
        });

        test('should convert links', () => {
            const mockADF = {
                version: 1,
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Visit '
                            },
                            {
                                type: 'text',
                                text: 'our website',
                                marks: [
                                    {
                                        type: 'link',
                                        attrs: {
                                            href: 'https://example.com'
                                        }
                                    }
                                ]
                            },
                            {
                                type: 'text',
                                text: ' for more info.'
                            }
                        ]
                    }
                ]
            };

            const markdown = JiraTicket.extractTextFromNodes(mockADF.content);
            
            console.log('=== Link Test ===');
            console.log('Input ADF:', JSON.stringify(mockADF, null, 2));
            console.log('Output Markdown:', markdown);
            console.log('Expected: "Visit [our website](https://example.com) for more info."');
            
            expect(markdown).toBe('Visit [our website](https://example.com) for more info.');
        });
    });

    describe('Complex ADF structures', () => {
        test('should convert bullet list with bold labels', () => {
            const mockADF = {
                version: 1,
                type: 'doc',
                content: [
                    {
                        type: 'bulletList',
                        content: [
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            {
                                                type: 'text',
                                                text: 'Language Parsers',
                                                marks: [
                                                    {
                                                        type: 'strong'
                                                    }
                                                ]
                                            },
                                            {
                                                type: 'text',
                                                text: ': AST generation for each supported language'
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            {
                                                type: 'text',
                                                text: 'Analysis Engine',
                                                marks: [
                                                    {
                                                        type: 'strong'
                                                    }
                                                ]
                                            },
                                            {
                                                type: 'text',
                                                text: ': Static analysis with ML-powered insights'
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            {
                                                type: 'text',
                                                text: 'Database',
                                                marks: [
                                                    {
                                                        type: 'strong'
                                                    }
                                                ]
                                            },
                                            {
                                                type: 'text',
                                                text: ': PostgreSQL with '
                                            },
                                            {
                                                type: 'text',
                                                text: 'Redis',
                                                marks: [
                                                    {
                                                        type: 'code'
                                                    }
                                                ]
                                            },
                                            {
                                                type: 'text',
                                                text: ' for caching'
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const markdown = JiraTicket.extractTextFromNodes(mockADF.content);
            
            console.log('=== Bullet List with Bold Labels Test ===');
            console.log('Input ADF:', JSON.stringify(mockADF, null, 2));
            console.log('Output Markdown:', markdown);
            console.log('Expected: "- **Language Parsers**: AST generation for each supported language\\n- **Analysis Engine**: Static analysis with ML-powered insights\\n- **Database**: PostgreSQL with `Redis` for caching"');
            
            expect(markdown).toBe('- **Language Parsers**: AST generation for each supported language\n- **Analysis Engine**: Static analysis with ML-powered insights\n- **Database**: PostgreSQL with `Redis` for caching');
        });

        test('should convert task list (checkboxes)', () => {
            const mockADF = {
                version: 1,
                type: 'doc',
                content: [
                    {
                        type: 'taskList',
                        attrs: {
                            localId: 'task-list-1'
                        },
                        content: [
                            {
                                type: 'taskItem',
                                attrs: {
                                    localId: 'task-1',
                                    state: 'TODO'
                                },
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            {
                                                type: 'text',
                                                text: 'First task with '
                                            },
                                            {
                                                type: 'text',
                                                text: 'bold',
                                                marks: [
                                                    {
                                                        type: 'strong'
                                                    }
                                                ]
                                            },
                                            {
                                                type: 'text',
                                                text: ' text'
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                type: 'taskItem',
                                attrs: {
                                    localId: 'task-2',
                                    state: 'DONE'
                                },
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            {
                                                type: 'text',
                                                text: 'Completed task'
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const markdown = JiraTicket.extractTextFromNodes(mockADF.content);
            
            console.log('=== Task List Test ===');
            console.log('Input ADF:', JSON.stringify(mockADF, null, 2));
            console.log('Output Markdown:', markdown);
            console.log('Expected: "- [ ] First task with **bold** text\\n- [x] Completed task"');
            
            expect(markdown).toBe('- [ ] First task with **bold** text\n- [x] Completed task');
        });

        test('should convert panel with rich content', () => {
            const mockADF = {
                version: 1,
                type: 'doc',
                content: [
                    {
                        type: 'panel',
                        attrs: {
                            panelType: 'success'
                        },
                        content: [
                            {
                                type: 'paragraph',
                                content: [
                                    {
                                        type: 'text',
                                        text: 'Acceptance Criteria',
                                        marks: [
                                            {
                                                type: 'strong'
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                type: 'taskList',
                                attrs: {
                                    localId: 'acceptance-criteria'
                                },
                                content: [
                                    {
                                        type: 'taskItem',
                                        attrs: {
                                            localId: 'criteria-1',
                                            state: 'TODO'
                                        },
                                        content: [
                                            {
                                                type: 'paragraph',
                                                content: [
                                                    {
                                                        type: 'text',
                                                        text: 'System responds to '
                                                    },
                                                    {
                                                        type: 'text',
                                                        text: 'voice commands',
                                                        marks: [
                                                            {
                                                                type: 'strong'
                                                            }
                                                        ]
                                                    }
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        type: 'taskItem',
                                        attrs: {
                                            localId: 'criteria-2',
                                            state: 'DONE'
                                        },
                                        content: [
                                            {
                                                type: 'paragraph',
                                                content: [
                                                    {
                                                        type: 'text',
                                                        text: 'API integration with '
                                                    },
                                                    {
                                                        type: 'text',
                                                        text: 'external service',
                                                        marks: [
                                                            {
                                                                type: 'em'
                                                            }
                                                        ]
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const markdown = JiraTicket.extractTextFromNodes(mockADF.content);
            
            console.log('=== Panel with Rich Content Test ===');
            console.log('Input ADF:', JSON.stringify(mockADF, null, 2));
            console.log('Output Markdown:', markdown);
            console.log('Expected panel content with title and checkboxes');
            
            // The exact expected output depends on how panels are handled
            expect(markdown).toContain('**Acceptance Criteria**');
            expect(markdown).toContain('- [ ] System responds to **voice commands**');
            expect(markdown).toContain('- [x] API integration with *external service*');
        });
    });

    describe('Real Jira ADF simulation', () => {
        test('should convert a complete Jira ticket ADF structure', () => {
            // This simulates what a real Jira ticket looks like in ADF format
            const mockJiraADF = {
                version: 1,
                type: 'doc',
                content: [
                    // Main description
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Build a sophisticated voice assistant with '
                            },
                            {
                                type: 'text',
                                text: 'AI capabilities',
                                marks: [
                                    {
                                        type: 'strong'
                                    }
                                ]
                            },
                            {
                                type: 'text',
                                text: ' and smart home integration.'
                            }
                        ]
                    },
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Key features include:'
                            }
                        ]
                    },
                    {
                        type: 'bulletList',
                        content: [
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            {
                                                type: 'text',
                                                text: 'Voice recognition with '
                                            },
                                            {
                                                type: 'text',
                                                text: 'wake word',
                                                marks: [
                                                    {
                                                        type: 'strong'
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            {
                                                type: 'text',
                                                text: 'Smart home device control'
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    // Acceptance Criteria Panel
                    {
                        type: 'panel',
                        attrs: {
                            panelType: 'success'
                        },
                        content: [
                            {
                                type: 'paragraph',
                                content: [
                                    {
                                        type: 'text',
                                        text: 'Acceptance Criteria',
                                        marks: [
                                            {
                                                type: 'strong'
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                type: 'taskList',
                                content: [
                                    {
                                        type: 'taskItem',
                                        attrs: {
                                            state: 'TODO'
                                        },
                                        content: [
                                            {
                                                type: 'paragraph',
                                                content: [
                                                    {
                                                        type: 'text',
                                                        text: 'Voice Commands',
                                                        marks: [
                                                            {
                                                                type: 'strong'
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        type: 'text',
                                                        text: ': System responds to "Hey Assistant" wake word'
                                                    }
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        type: 'taskItem',
                                        attrs: {
                                            state: 'DONE'
                                        },
                                        content: [
                                            {
                                                type: 'paragraph',
                                                content: [
                                                    {
                                                        type: 'text',
                                                        text: 'Device Control',
                                                        marks: [
                                                            {
                                                                type: 'strong'
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        type: 'text',
                                                        text: ': Can control lights and temperature'
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    // Implementation Details Panel
                    {
                        type: 'panel',
                        attrs: {
                            panelType: 'info'
                        },
                        content: [
                            {
                                type: 'paragraph',
                                content: [
                                    {
                                        type: 'text',
                                        text: 'Implementation Details',
                                        marks: [
                                            {
                                                type: 'strong'
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                type: 'paragraph',
                                content: [
                                    {
                                        type: 'text',
                                        text: 'Framework',
                                        marks: [
                                            {
                                                type: 'strong'
                                            }
                                        ]
                                    },
                                    {
                                        type: 'text',
                                        text: ': React Native with '
                                    },
                                    {
                                        type: 'text',
                                        text: 'TypeScript',
                                        marks: [
                                            {
                                                type: 'code'
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                type: 'paragraph',
                                content: [
                                    {
                                        type: 'text',
                                        text: 'Database',
                                        marks: [
                                            {
                                                type: 'strong'
                                            }
                                        ]
                                    },
                                    {
                                        type: 'text',
                                        text: ': PostgreSQL for user data'
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const markdown = JiraTicket.extractTextFromNodes(mockJiraADF.content);
            
            console.log('=== Complete Jira Ticket ADF Test ===');
            console.log('Input ADF:', JSON.stringify(mockJiraADF, null, 2));
            console.log('Output Markdown:', markdown);
            console.log('========================');
            
            // Test key elements are preserved
            expect(markdown).toContain('Build a sophisticated voice assistant with **AI capabilities**');
            expect(markdown).toContain('**Acceptance Criteria**');
            expect(markdown).toContain('- [ ] **Voice Commands**: System responds to "Hey Assistant" wake word');
            expect(markdown).toContain('- [x] **Device Control**: Can control lights and temperature');
            expect(markdown).toContain('**Implementation Details**');
            expect(markdown).toContain('**Framework**: React Native with `TypeScript`');
            expect(markdown).toContain('**Database**: PostgreSQL for user data');
        });
    });
}); 