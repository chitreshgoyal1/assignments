class CreateUsers < ActiveRecord::Migration
  def change
    create_table :users do |t|
      t.string :name
      t.integer :parent_id

      t.timestamps
    end
    User.create :name=> "root", :parent_id => ""
  end
end
