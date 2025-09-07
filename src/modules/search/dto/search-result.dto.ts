export class SearchResultDto<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
  
    constructor(results: T[], total: number, page: number, pageSize: number) {
      this.data = results;
      this.total = total;
      this.page = page;
      this.pageSize = pageSize;
    }
  }