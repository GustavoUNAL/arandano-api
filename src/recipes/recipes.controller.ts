import { Controller, Get, Query } from '@nestjs/common';
import { RecipesService } from './recipes.service';

@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipesService: RecipesService) {}

  @Get('costs')
  costs() {
    return this.recipesService.listRecipeCosts();
  }

  @Get()
  catalog(@Query('categoryId') categoryId?: string) {
    return this.recipesService.listCatalog(categoryId);
  }
}
