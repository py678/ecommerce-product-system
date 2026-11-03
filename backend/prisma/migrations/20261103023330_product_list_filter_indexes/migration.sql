-- CreateIndex
CREATE INDEX "products_stock_created_at_idx" ON "products"("stock", "created_at");

-- CreateIndex
CREATE INDEX "products_price_created_at_idx" ON "products"("price", "created_at");

-- CreateIndex
CREATE INDEX "products_updated_at_idx" ON "products"("updated_at");
