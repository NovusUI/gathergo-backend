import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

@Injectable()
export class GithubTemplateService {
  private octokit: Octokit;
  private readonly logger = new Logger(GithubTemplateService.name);

  constructor(private configService: ConfigService) {
    const token = this.configService.get<string>('github.token');
    this.octokit = new Octokit({ auth: token });
  }

  async getTemplate(
    templateName: string,
    variables: Record<string, any>
  ): Promise<string> {
    try {
      const owner = this.configService.get<string>('github.owner') || "";
      const repo = this.configService.get<string>('github.repo') || "";
      const templatesPath = this.configService.get<string>('github.templatesPath');

      // Try to get the template file
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: `${templatesPath}/${templateName}.html`,
      });

      if ('content' in data) {
        let template = Buffer.from(data.content, 'base64').toString('utf-8');
        
        // Replace variables in template
        template = this.replaceVariables(template, variables);
        
        return template;
      }

      throw new Error(`Template ${templateName} not found or is not a file`);
    } catch (error) {
      this.logger.error(`Failed to fetch template ${templateName}:`, error);
      throw error;
    }
  }

  private replaceVariables(template: string, variables: Record<string, any>): string {
    let result = template;
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      result = result.replace(regex, value || '');
    }
    
    return result;
  }

  async listTemplates(): Promise<string[]> {
    try {
      const owner = this.configService.get<string>('github.owner') || "";
      const repo = this.configService.get<string>('github.repo') || "";
      const templatesPath = this.configService.get<string>('github.templatesPath') || "";

      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: templatesPath,
      });

      if (Array.isArray(data)) {
        return data
          .filter(item => item.name.endsWith('.html'))
          .map(item => item.name.replace('.html', ''));
      }

      return [];
    } catch (error) {
      this.logger.error('Failed to list templates:', error);
      return [];
    }
  }
}