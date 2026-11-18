import { Controller, Get, Query } from '@nestjs/common';
import { Product } from './product.entity';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query('q') q?: string | string[]): Promise<Product[]> {
    const query = Array.isArray(q) ? q[0] : q;
    return this.productsService.search(query);
  }
}
